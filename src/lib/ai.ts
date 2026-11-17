/**
 * All model calls go through Firebase AI Logic hybrid inference.
 *
 *  - Entity detection:  ONLY_ON_DEVICE (raw text never leaves), or with explicit
 *                       consent ONLY_IN_CLOUD on text the pattern shield already masked.
 *  - Light tasks:       PREFER_ON_DEVICE (local when possible, cloud fallback).
 *  - Heavy tasks:       PREFER_IN_CLOUD / ONLY_IN_CLOUD on the blindfolded text.
 *  - Offline / strict:  ONLY_ON_DEVICE.
 *
 * `response.inferenceSource` is reported back for every call so the UI shows
 * where each answer was actually produced.
 */
import { getGenerativeModel, InferenceMode, InferenceSource, Schema } from 'firebase/ai';
import type { GenerativeModel, HybridParams, LanguageModelExpected, Part } from 'firebase/ai';
import { splitIntoChunks } from './chunk';
import { getServices } from './firebase';
import type { AppConfig } from './firebase';
import { DETECT_SYSTEM, detectPrompt, TRANSCRIBE_PROMPT } from './prompts';
import type { DeviceStatus, RouteMode } from './router';
import type { Detection, EntityType } from './types';

export type Source = 'on_device' | 'in_cloud';

const TEXT_IO: LanguageModelExpected[] = [{ type: 'text', languages: ['en'] }];

const MODE: Record<Exclude<RouteMode, 'blocked'>, InferenceMode> = {
  only_on_device: InferenceMode.ONLY_ON_DEVICE,
  prefer_on_device: InferenceMode.PREFER_ON_DEVICE,
  prefer_in_cloud: InferenceMode.PREFER_IN_CLOUD,
  only_in_cloud: InferenceMode.ONLY_IN_CLOUD,
};

const toSource = (s: InferenceSource | undefined, fallback: Source): Source =>
  s === InferenceSource.ON_DEVICE ? 'on_device' : s === InferenceSource.IN_CLOUD ? 'in_cloud' : fallback;

function requireAI() {
  const s = getServices();
  if (!s) throw new Error('Firebase is not configured yet. Add your web app config to .env.local (see README).');
  return s.ai;
}

/** Asks Chrome whether the built-in model can run here. Inference itself always goes through Firebase AI Logic. */
export async function probeDevice(): Promise<DeviceStatus> {
  const LM = (globalThis as { LanguageModel?: { availability?: (o: object) => Promise<string> } }).LanguageModel;
  if (!LM?.availability) return 'unavailable';
  try {
    const status = await LM.availability({ expectedInputs: TEXT_IO, expectedOutputs: TEXT_IO });
    return status === 'available' || status === 'downloadable' || status === 'downloading' ? status : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Starts (or resumes) the on-device model download. Must be called from a user gesture. */
export async function prepareDeviceModel(onProgress: (fraction: number) => void): Promise<void> {
  const model = getGenerativeModel(requireAI(), {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { createOptions: { expectedInputs: TEXT_IO, expectedOutputs: TEXT_IO } },
  });
  await model.initializeDeviceModel(onProgress);
}

const AI_TYPES: EntityType[] = ['PERSON', 'ORG', 'LOCATION', 'ID'];

const entitySchema = Schema.object({
  properties: {
    entities: Schema.array({
      items: Schema.object({
        properties: {
          text: Schema.string(),
          type: Schema.enumString({ enum: AI_TYPES }),
        },
      }),
    }),
  },
});

export interface DetectOptions {
  text: string;
  device: DeviceStatus;
  /** The user opted in to cloud-assisted detection for this document. */
  allowCloud: boolean;
  config: AppConfig;
  /** Masks what the pattern shield already knows before a chunk may go to the cloud. */
  preMask: (chunk: string) => string;
  onProgress?: (done: number, total: number) => void;
}

export interface DetectResult {
  detections: Detection[];
  source: Source | null;
  failedChunks: number;
  /** Characters sent to the cloud for detection (0 when it ran on-device). */
  cloudChars: number;
}

/**
 * Finds names, organizations and places that patterns cannot see.
 * On a capable device this is ONLY_ON_DEVICE: the original text stays local.
 */
export async function detectEntities(opts: DetectOptions): Promise<DetectResult> {
  const onDevice = opts.device === 'available';
  if (!onDevice && !opts.allowCloud) return { detections: [], source: null, failedChunks: 0, cloudChars: 0 };

  const params: HybridParams = onDevice
    ? {
        mode: InferenceMode.ONLY_ON_DEVICE,
        onDeviceParams: {
          createOptions: {
            expectedInputs: TEXT_IO,
            expectedOutputs: TEXT_IO,
            initialPrompts: [{ role: 'system', content: [{ type: 'text', value: DETECT_SYSTEM }] }],
          },
          promptOptions: { responseConstraint: entitySchema },
        },
      }
    : {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: {
          model: opts.config.fallback_cloud_model,
          systemInstruction: DETECT_SYSTEM,
          generationConfig: { responseMimeType: 'application/json', responseSchema: entitySchema, temperature: 0 },
        },
      };
  const model = getGenerativeModel(requireAI(), params);

  const chunks = splitIntoChunks(opts.text, opts.config.detect_chunk_chars);
  const detections: Detection[] = [];
  let failedChunks = 0;
  let cloudChars = 0;
  let source: Source | null = null;
  let firstError: unknown;

  for (let i = 0; i < chunks.length; i++) {
    opts.onProgress?.(i, chunks.length);
    const chunk = chunks[i];
    const payload = detectPrompt(onDevice ? chunk : opts.preMask(chunk));
    try {
      const result = await model.generateContent(payload);
      source = toSource(result.response.inferenceSource, onDevice ? 'on_device' : 'in_cloud');
      if (source === 'in_cloud') cloudChars += payload.length;
      const parsed = JSON.parse(result.response.text()) as { entities?: Array<{ text?: unknown; type?: unknown }> };
      const haystack = chunk.toLowerCase();
      for (const e of parsed.entities ?? []) {
        if (typeof e.text !== 'string' || !AI_TYPES.includes(e.type as EntityType)) continue;
        const text = e.text.trim();
        // Drop anything the model did not literally copy from the text.
        if (!text || !haystack.includes(text.toLowerCase())) continue;
        detections.push({ text, type: e.type as EntityType, source });
      }
    } catch (err) {
      failedChunks++;
      firstError ??= err;
    }
  }
  opts.onProgress?.(chunks.length, chunks.length);
  if (failedChunks === chunks.length && firstError) throw firstError;
  return { detections, source, failedChunks, cloudChars };
}

export interface TaskOptions {
  prompt: string;
  mode: Exclude<RouteMode, 'blocked'>;
  config: AppConfig;
  onText: (textSoFar: string) => void;
}

export interface TaskResult {
  text: string;
  source: Source;
  /** Cloud model configured for this call (used only if the call ran in the cloud). */
  cloudModel: string;
}

const taskModels = new Map<string, GenerativeModel>();

function taskModel(mode: InferenceMode, cloudModel: string): GenerativeModel {
  const key = `${mode}|${cloudModel}`;
  let model = taskModels.get(key);
  if (!model) {
    model = getGenerativeModel(requireAI(), {
      mode,
      inCloudParams: { model: cloudModel, generationConfig: { temperature: 0.3 } },
      onDeviceParams: { createOptions: { expectedInputs: TEXT_IO, expectedOutputs: TEXT_IO } },
    });
    taskModels.set(key, model);
  }
  return model;
}

/** Runs one blindfolded request with the routed inference mode and streams the answer. */
export async function runTask(opts: TaskOptions): Promise<TaskResult> {
  const lightPath = opts.mode === 'prefer_on_device' || opts.mode === 'only_on_device';
  const cloudModel = lightPath ? opts.config.fallback_cloud_model : opts.config.cloud_model;
  const model = taskModel(MODE[opts.mode], cloudModel);

  const result = await model.generateContentStream(opts.prompt);
  let text = '';
  for await (const chunk of result.stream) {
    text += chunk.text();
    opts.onText(text);
  }
  const response = await result.response;
  const finalText = text || response.text();
  const expected: Source = opts.mode === 'only_on_device' ? 'on_device' : 'in_cloud';
  return { text: finalText, source: toSource(response.inferenceSource, expected), cloudModel };
}

async function fileToPart(file: File): Promise<Part> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return { type: 'inlineData', inlineData: { data: dataUrl.split(',')[1], mimeType: file.type } };
}

/**
 * Reads the text out of a screenshot or photo (PNG/JPEG).
 * ONLY_ON_DEVICE when the local model is ready; otherwise the caller must have
 * the user's consent, because the unmasked image goes to the cloud.
 */
export async function transcribeImage(
  file: File,
  device: DeviceStatus,
  config: AppConfig,
): Promise<{ text: string; source: Source }> {
  const onDevice = device === 'available';
  const model = getGenerativeModel(requireAI(), {
    mode: onDevice ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: { model: config.fallback_cloud_model, generationConfig: { temperature: 0 } },
    onDeviceParams: { createOptions: { expectedInputs: [...TEXT_IO, { type: 'image' }], expectedOutputs: TEXT_IO } },
  });
  const result = await model.generateContent([TRANSCRIBE_PROMPT, await fileToPart(file)]);
  return {
    text: result.response.text().trim(),
    source: toSource(result.response.inferenceSource, onDevice ? 'on_device' : 'in_cloud'),
  };
}

/** Turns SDK errors into something a person can act on. */
export function explainError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.toLowerCase();
  if (m.includes('not configured')) return raw;
  if (m.includes('app check') || m.includes('appcheck') || m.includes('app-check')) {
    return 'App Check rejected the request. Register this browser\'s debug token (printed in the console) or set a reCAPTCHA Enterprise site key. See README.';
  }
  if (m.includes('api-not-enabled') || m.includes('has not been used') || m.includes('permission_denied')) {
    return 'Firebase AI Logic is not enabled for this project yet. Run "npx -y firebase-tools@latest init ailogic" in the project folder.';
  }
  if (m.includes('429') || m.includes('quota') || m.includes('resource_exhausted')) {
    return 'The cloud model is out of quota right now. Light tasks still run on-device where available; try again in a minute.';
  }
  if (m.includes('unsupported') || m.includes('on-device') || m.includes('on device') || m.includes('languagemodel')) {
    return `The on-device model could not handle this request (${raw}).`;
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'Could not reach the cloud model. Check your connection, or turn on Strict local to stay on this device.';
  }
  return raw;
}
