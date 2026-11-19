import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These tests replace the Firebase AI Logic SDK with a small fake so the
 * hybrid orchestration can be checked without a browser or a network:
 * which inference mode and cloud model each call uses, what text is sent,
 * and how failures are handled.
 */
interface Call {
  mode: string;
  cloudModel?: string;
  prompt: string;
}

const h = vi.hoisted(() => ({
  calls: [] as Call[],
  respond: (_call: Call): { text: string; source: string } => ({ text: 'ok', source: 'in_cloud' }),
}));

vi.mock('firebase/ai', () => {
  const record = (params: { mode: string; inCloudParams?: { model?: string } }, prompt: unknown): Call => {
    const call = {
      mode: params.mode,
      cloudModel: params.inCloudParams?.model,
      prompt: typeof prompt === 'string' ? prompt : JSON.stringify(prompt),
    };
    h.calls.push(call);
    return call;
  };
  return {
    InferenceMode: {
      PREFER_ON_DEVICE: 'prefer_on_device',
      ONLY_ON_DEVICE: 'only_on_device',
      ONLY_IN_CLOUD: 'only_in_cloud',
      PREFER_IN_CLOUD: 'prefer_in_cloud',
    },
    InferenceSource: { ON_DEVICE: 'on_device', IN_CLOUD: 'in_cloud' },
    Schema: {
      object: (o: object) => ({ type: 'object', ...o }),
      array: (o: object) => ({ type: 'array', ...o }),
      string: () => ({ type: 'string' }),
      enumString: (o: object) => ({ type: 'string', ...o }),
    },
    getGenerativeModel: (_ai: unknown, params: { mode: string; inCloudParams?: { model?: string } }) => ({
      initializeDeviceModel: async () => {},
      generateContent: async (prompt: unknown) => {
        const r = h.respond(record(params, prompt));
        return { response: { text: () => r.text, inferenceSource: r.source } };
      },
      generateContentStream: async (prompt: unknown) => {
        const r = h.respond(record(params, prompt));
        const pieces = r.text.match(/[\s\S]{1,7}/g) ?? [];
        return {
          stream: (async function* () {
            for (const piece of pieces) yield { text: () => piece };
          })(),
          response: Promise.resolve({ text: () => r.text, inferenceSource: r.source }),
        };
      },
    }),
  };
});

vi.mock('./firebase', () => ({ getServices: () => ({ ai: {} }) }));

import { detectEntities, explainError, runTask } from './ai';
import type { AppConfig } from './firebase';

const config: AppConfig = {
  cloud_model: 'big-model',
  fallback_cloud_model: 'lite-model',
  on_device_token_budget: 4000,
  detect_chunk_chars: 1600,
  allow_cloud_detection: true,
  max_document_chars: 60000,
};

beforeEach(() => {
  h.calls.length = 0;
  h.respond = () => ({ text: 'ok', source: 'in_cloud' });
});

describe('runTask', () => {
  it('streams the answer and reports where it actually ran', async () => {
    h.respond = () => ({ text: '[PERSON_1] owes [MONEY_1].', source: 'on_device' });
    const seen: string[] = [];
    const result = await runTask({ prompt: 'p', mode: 'prefer_on_device', config, onText: (t) => seen.push(t) });
    expect(result).toEqual({ text: '[PERSON_1] owes [MONEY_1].', source: 'on_device', cloudModel: 'lite-model' });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe('[PERSON_1] owes [MONEY_1].');
  });

  it('uses the light model for on-device-first routes and the heavy model for cloud routes', async () => {
    await runTask({ prompt: 'a', mode: 'prefer_on_device', config, onText: () => {} });
    await runTask({ prompt: 'b', mode: 'only_in_cloud', config, onText: () => {} });
    await runTask({ prompt: 'c', mode: 'prefer_in_cloud', config, onText: () => {} });
    expect(h.calls.map((c) => `${c.mode}:${c.cloudModel}`)).toEqual([
      'prefer_on_device:lite-model',
      'only_in_cloud:big-model',
      'prefer_in_cloud:big-model',
    ]);
  });

  it('retries once on the light model when the heavy model is unavailable to the project', async () => {
    h.respond = (call) => {
      if (call.cloudModel === 'big-model') throw new Error('[403] The Gemini API free tier is not available for this project.');
      return { text: 'answer', source: 'in_cloud' };
    };
    const result = await runTask({ prompt: 'p', mode: 'only_in_cloud', config, onText: () => {} });
    expect(result.cloudModel).toBe('lite-model');
    expect(h.calls.map((c) => c.cloudModel)).toEqual(['big-model', 'lite-model']);
    expect(h.calls[1].mode).toBe('only_in_cloud');
  });

  it('does not retry other failures, or when no lighter model is left', async () => {
    h.respond = () => {
      throw new Error('Failed to fetch');
    };
    await expect(runTask({ prompt: 'p', mode: 'only_in_cloud', config, onText: () => {} })).rejects.toThrow('Failed to fetch');
    expect(h.calls.length).toBe(1);

    h.calls.length = 0;
    h.respond = () => {
      throw new Error('The Gemini API free tier is not available for this project.');
    };
    await expect(runTask({ prompt: 'p', mode: 'prefer_on_device', config, onText: () => {} })).rejects.toThrow('free tier');
    expect(h.calls.length).toBe(1);
  });
});

describe('detectEntities', () => {
  const text = 'Priya Raman signed for Harbor Studio. Call +1 (415) 555-0134.';
  const preMask = (chunk: string) => chunk.replace('+1 (415) 555-0134', '[PHONE_1]');

  it('keeps the original text on the device when a local model is ready', async () => {
    h.respond = () => ({
      source: 'on_device',
      text: JSON.stringify({
        entities: [
          { text: 'Priya Raman', type: 'PERSON' },
          { text: 'Harbor Studio', type: 'ORG' },
          { text: 'Somebody Else', type: 'PERSON' }, // not in the text: dropped
          { text: 'signed', type: 'VERB' }, // not an allowed type: dropped
        ],
      }),
    });
    const result = await detectEntities({ text, device: 'available', allowCloud: false, config, preMask });
    expect(h.calls.every((c) => c.mode === 'only_on_device')).toBe(true);
    expect(h.calls[0].prompt).toContain('+1 (415) 555-0134');
    expect(result.source).toBe('on_device');
    expect(result.cloudChars).toBe(0);
    expect(result.detections.map((d) => `${d.type}:${d.text}:${d.source}`)).toEqual([
      'PERSON:Priya Raman:on_device',
      'ORG:Harbor Studio:on_device',
    ]);
  });

  it('never calls a model without a local model or explicit consent', async () => {
    const result = await detectEntities({ text, device: 'unavailable', allowCloud: false, config, preMask });
    expect(h.calls).toEqual([]);
    expect(result).toEqual({ detections: [], source: null, failedChunks: 0, cloudChars: 0 });
  });

  it('with consent, sends only pattern-masked text to the cloud and counts it', async () => {
    h.respond = () => ({ source: 'in_cloud', text: JSON.stringify({ entities: [{ text: 'Priya Raman', type: 'PERSON' }] }) });
    const result = await detectEntities({ text, device: 'unavailable', allowCloud: true, config, preMask });
    expect(h.calls[0].mode).toBe('only_in_cloud');
    expect(h.calls[0].cloudModel).toBe('lite-model');
    expect(h.calls[0].prompt).toContain('[PHONE_1]');
    expect(h.calls[0].prompt).not.toContain('555-0134');
    expect(result.cloudChars).toBe(h.calls[0].prompt.length);
    expect(result.detections).toEqual([{ text: 'Priya Raman', type: 'PERSON', source: 'in_cloud' }]);
  });

  it('scans long documents chunk by chunk and survives a failed chunk', async () => {
    const long = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} mentions Priya Raman and nothing else of note.`).join('\n\n');
    let n = 0;
    h.respond = () => {
      if (n++ === 0) throw new Error('model busy');
      return { source: 'on_device', text: JSON.stringify({ entities: [{ text: 'Priya Raman', type: 'PERSON' }] }) };
    };
    const progress: string[] = [];
    const result = await detectEntities({
      text: long,
      device: 'available',
      allowCloud: false,
      config: { ...config, detect_chunk_chars: 250 },
      preMask,
      onProgress: (done, total) => progress.push(`${done}/${total}`),
    });
    expect(h.calls.length).toBeGreaterThan(2);
    expect(result.failedChunks).toBe(1);
    expect(result.detections.length).toBe(h.calls.length - 1);
    expect(progress.at(-1)).toBe(`${h.calls.length}/${h.calls.length}`);
  });

  it('reports the error when every chunk fails', async () => {
    h.respond = () => {
      throw new Error('on-device model crashed');
    };
    await expect(detectEntities({ text, device: 'available', allowCloud: false, config, preMask })).rejects.toThrow('crashed');
  });
});

describe('explainError', () => {
  it('turns SDK errors into something a person can act on', () => {
    expect(explainError(new Error('[403] The Gemini API free tier is not available for this project.'))).toMatch(/billing account/);
    expect(explainError(new Error('AppCheck: Fetch server returned an HTTP error status. HTTP status: 403.'))).toMatch(/App Check rejected/);
    expect(explainError(new Error('Firebase: Error (auth/operation-not-allowed).'))).toMatch(/Google sign-in is not enabled/);
    expect(explainError(new Error('429 RESOURCE_EXHAUSTED'))).toMatch(/quota/);
    expect(explainError(new Error('Failed to fetch'))).toMatch(/connection/);
    expect(explainError('something odd')).toBe('something odd');
  });
});
