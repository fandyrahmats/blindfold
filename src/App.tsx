import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { Conversation } from './components/Conversation';
import type { Turn } from './components/Conversation';
import { Header } from './components/Header';
import { Intake } from './components/Intake';
import { Workspace } from './components/Workspace';
import type { ScanState } from './components/Workspace';
import { detectEntities, explainError, prepareDeviceModel, probeDevice, runTask, transcribeImage } from './lib/ai';
import { estimateTokens } from './lib/chunk';
import { detectPatterns } from './lib/detectors';
import { DEFAULT_CONFIG, getServices, isFirebaseConfigured, loadConfig } from './lib/firebase';
import type { AppConfig } from './lib/firebase';
import { buildTaskPrompt } from './lib/prompts';
import type { TaskPreset } from './lib/prompts';
import {
  addDetections,
  emptyVault,
  findLeaks,
  maskSegments,
  maskText,
  segment,
  setEntityEnabled,
  setTypeEnabled,
  shieldStats,
} from './lib/pseudonymize';
import { decideRoute } from './lib/router';
import type { DeviceStatus } from './lib/router';
import {
  deleteThread,
  loadLocal,
  saveLocal,
  saveThread,
  signInWithGoogle,
  signOutUser,
  watchThreads,
  watchUser,
  wipeLocal,
} from './lib/store';
import type { SavedThread } from './lib/store';
import type { VaultState } from './lib/types';

const newId = () => crypto.randomUUID();

export default function App() {
  const configured = isFirebaseConfigured;
  const appCheckReady = getServices()?.appCheckReady ?? false;

  const [device, setDevice] = useState<DeviceStatus>('unknown');
  const [progress, setProgress] = useState<number | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [user, setUser] = useState<User | null>(null);
  const [threads, setThreads] = useState<SavedThread[]>([]);

  const [phase, setPhase] = useState<'intake' | 'workspace'>('intake');
  const [threadId, setThreadId] = useState('');
  const [text, setText] = useState('');
  const [vault, setVault] = useState<VaultState>(emptyVault);
  const [foreign, setForeign] = useState(false);
  const [scan, setScan] = useState<ScanState>({ state: 'idle' });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [detectCloudChars, setDetectCloudChars] = useState(0);

  const [allowCloud, setAllowCloud] = useState(false);
  const [strictLocal, setStrictLocal] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const scanToken = useRef(0);

  /* ---------- environment ---------- */

  useEffect(() => {
    probeDevice().then(setDevice);
    loadConfig().then(setConfig);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const stopAuth = watchUser(setUser);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      stopAuth();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setThreads([]);
      return;
    }
    return watchThreads(user.uid, setThreads);
  }, [user]);

  const enableDevice = useCallback(async () => {
    setProgress(0);
    try {
      await prepareDeviceModel(setProgress);
    } catch (err) {
      setNotice(explainError(err));
    } finally {
      setProgress(null);
      setDevice(await probeDevice());
    }
  }, []);

  /* ---------- document + shield ---------- */

  const segments = useMemo(() => segment(text, vault), [text, vault]);
  const stats = useMemo(() => shieldStats(segments), [segments]);
  const masked = useMemo(() => maskSegments(segments), [segments]);

  const canCloudDetect = configured && online && config.allow_cloud_detection;

  const runScan = useCallback(
    async (docText: string, baseVault: VaultState) => {
      const token = ++scanToken.current;
      const useDevice = configured && device === 'available';
      const useCloud = !useDevice && canCloudDetect && allowCloud;
      if (!useDevice && !useCloud) {
        setScan({ state: 'done', source: null, found: 0, failed: 0 });
        return;
      }
      setScan({ state: 'scanning', done: 0, total: 1 });
      try {
        const result = await detectEntities({
          text: docText,
          device,
          allowCloud: useCloud,
          config,
          preMask: (chunk) => maskText(chunk, baseVault),
          onProgress: (done, total) => {
            if (token === scanToken.current) setScan({ state: 'scanning', done, total });
          },
        });
        if (token !== scanToken.current) return;
        setVault((v) => addDetections(v, result.detections));
        setDetectCloudChars((c) => c + result.cloudChars);
        setScan({ state: 'done', source: result.source, found: result.detections.length, failed: result.failedChunks });
      } catch (err) {
        if (token === scanToken.current) setScan({ state: 'error', message: explainError(err) });
      }
    },
    [configured, device, canCloudDetect, allowCloud, config],
  );

  const start = useCallback(
    (raw: string) => {
      const docText = raw.replace(/\r\n?/g, '\n').trim().slice(0, config.max_document_chars);
      if (!docText) return;
      const base = addDetections(emptyVault(), detectPatterns(docText));
      setThreadId(newId());
      setText(docText);
      setVault(base);
      setForeign(false);
      setTurns([]);
      setDetectCloudChars(0);
      setNotice(null);
      setPhase('workspace');
      window.scrollTo({ top: 0 });
      void runScan(docText, base);
    },
    [config.max_document_chars, runScan],
  );

  const readImage = useCallback(
    async (file: File) => {
      if (device !== 'available') {
        const ok = window.confirm(
          'This device has no on-device model, so the image itself would be sent to the cloud model to read its text. Nothing in it is blindfolded yet. Continue?',
        );
        if (!ok) return;
      }
      setImageBusy(true);
      setNotice(null);
      try {
        const result = await transcribeImage(file, device, config);
        if (!result.text) throw new Error('No text was found in that image.');
        start(result.text);
      } catch (err) {
        setNotice(explainError(err));
      } finally {
        setImageBusy(false);
      }
    },
    [device, config, start],
  );

  const goHome = useCallback(() => {
    scanToken.current++;
    setPhase('intake');
    setNotice(null);
  }, []);

  const openThread = useCallback((thread: SavedThread) => {
    scanToken.current++;
    const local = loadLocal(thread.id);
    setThreadId(thread.id);
    setText(local ? local.text : thread.maskedDocument);
    setVault(local ? local.vault : emptyVault());
    setForeign(!local);
    setScan({ state: 'idle' });
    setDetectCloudChars(0);
    setTurns(
      thread.turns.map((t, i) => ({
        id: `${thread.id}-${i}`,
        label: t.label,
        question: t.question,
        prompt: '',
        answer: t.answer,
        status: 'done',
        mode: t.mode as Turn['mode'],
        reason: 'Restored from your saved thread. Only this blindfolded text is stored in Firestore.',
        source: t.source,
        at: t.at,
      })),
    );
    setPhase('workspace');
    window.scrollTo({ top: 0 });
  }, []);

  // The original text and the vault are persisted in this browser only.
  useEffect(() => {
    if (phase === 'workspace' && threadId && !foreign) saveLocal(threadId, { text, vault });
  }, [phase, threadId, foreign, text, vault]);

  // Firestore receives the blindfolded thread, never the vault.
  const doneTurns = useMemo(() => turns.filter((t) => t.status === 'done' && t.source), [turns]);
  useEffect(() => {
    if (!user || !threadId || foreign || doneTurns.length === 0) return;
    const title = masked.split('\n').find((line) => line.trim())?.trim() ?? 'Untitled';
    saveThread(user.uid, {
      id: threadId,
      title,
      maskedDocument: masked,
      protectedValues: stats.protectedValues,
      updatedAt: doneTurns[doneTurns.length - 1].at,
      turns: doneTurns.map((t) => ({
        label: t.label,
        question: t.question,
        answer: t.answer,
        source: t.source!,
        mode: t.mode,
        at: t.at,
      })),
    }).catch(() => {});
  }, [user, threadId, foreign, doneTurns, masked, stats.protectedValues]);

  /* ---------- asking ---------- */

  const promptFor = useCallback(
    (instruction: string) => {
      const question = foreign ? instruction : maskText(instruction, vault);
      const history = doneTurns.slice(-3).map((t) => ({ question: t.question, answer: t.answer }));
      return { question, prompt: buildTaskPrompt(masked, question, history) };
    },
    [foreign, vault, doneTurns, masked],
  );

  const preview = useCallback(
    (weight: TaskPreset['weight']) =>
      decideRoute({
        weight,
        promptTokens: estimateTokens(masked) + 350,
        device,
        online,
        strictLocal,
        onDeviceTokenBudget: config.on_device_token_budget,
      }),
    [masked, device, online, strictLocal, config.on_device_token_budget],
  );

  const ask = useCallback(
    async (label: string, instruction: string, weight: TaskPreset['weight']) => {
      const { question, prompt } = promptFor(instruction);
      const route = decideRoute({
        weight,
        promptTokens: estimateTokens(prompt),
        device,
        online,
        strictLocal,
        onDeviceTokenBudget: config.on_device_token_budget,
      });
      const id = newId();
      const turn: Turn = { id, label, question, prompt, answer: '', status: 'streaming', mode: route.mode, reason: route.reason, at: Date.now() };
      const patch = (changes: Partial<Turn>) =>
        setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...changes } : t)));

      // Last line of defence: nothing goes out if a protected value is still in the payload.
      const leaks = findLeaks(prompt, vault);
      if (leaks.length > 0) {
        const names = leaks.slice(0, 4).map((e) => e.id.replace('_', ' ')).join(', ');
        setTurns((all) => [
          ...all,
          { ...turn, status: 'blocked', mode: 'blocked', reason: `Leak check stopped this request: ${names} would still be readable. Blindfold or allow the overlapping value, then try again.` },
        ]);
        return;
      }
      if (route.mode === 'blocked') {
        setTurns((all) => [...all, { ...turn, status: 'blocked' }]);
        return;
      }
      if (!configured) {
        setTurns((all) => [
          ...all,
          { ...turn, status: 'blocked', reason: `Firebase is not connected yet, so nothing was sent. With a project connected this would use ${route.mode.toUpperCase()}: ${route.reason}` },
        ]);
        return;
      }

      setTurns((all) => [...all, turn]);
      const started = performance.now();
      try {
        const result = await runTask({ prompt, mode: route.mode, config, onText: (answer) => patch({ answer }) });
        patch({ answer: result.text, source: result.source, cloudModel: result.cloudModel, status: 'done', ms: performance.now() - started });
      } catch (err) {
        patch({ status: 'error', error: explainError(err) });
      }
    },
    [promptFor, device, online, strictLocal, config, vault, configured],
  );

  const ledger = useMemo(() => {
    const sent = turns.filter((t) => t.source === 'in_cloud');
    return {
      cloudChars: detectCloudChars + sent.reduce((n, t) => n + t.prompt.length, 0),
      cloudRuns: sent.length,
      deviceRuns: turns.filter((t) => t.source === 'on_device').length,
      protectedValues: stats.protectedValues,
      namesSeenByCloud: detectCloudChars > 0,
    };
  }, [turns, detectCloudChars, stats.protectedValues]);

  const busy = turns.some((t) => t.status === 'streaming');

  return (
    <div className="app">
      <Header
        configured={configured}
        appCheckReady={appCheckReady}
        device={device}
        progress={progress}
        online={online}
        user={user}
        onHome={goHome}
        onEnableDevice={enableDevice}
        onSignIn={() => signInWithGoogle().catch((err) => setNotice(explainError(err)))}
        onSignOut={() => void signOutUser()}
        onWipe={() => {
          if (!window.confirm('Delete every original document and vault stored in this browser? Blindfolded threads in your account are kept.')) return;
          const removed = wipeLocal();
          setNotice(`Local vault wiped: ${removed} ${removed === 1 ? 'document' : 'documents'} removed from this browser.`);
          goHome();
        }}
      />

      {phase === 'intake' ? (
        <Intake
          configured={configured}
          device={device}
          maxChars={config.max_document_chars}
          cloudDetectOption={canCloudDetect && device !== 'available' && device !== 'unknown'}
          allowCloud={allowCloud}
          onAllowCloud={setAllowCloud}
          imageBusy={imageBusy}
          notice={notice}
          threads={threads}
          onStart={start}
          onImage={readImage}
          onOpenThread={openThread}
          onDeleteThread={(t) => {
            if (user && window.confirm(`Delete "${t.title}" from your account and this browser?`)) {
              deleteThread(user.uid, t.id).catch((err) => setNotice(explainError(err)));
            }
          }}
        />
      ) : (
        <main className="work">
          <div className="work-bar">
            <button className="link" onClick={goHome}>
              ← New document
            </button>
            {notice && <p className="notice">{notice}</p>}
          </div>
          <Workspace
            segments={segments}
            stats={stats}
            scan={scan}
            foreign={foreign}
            canRescan={!foreign && configured && (device === 'available' || (canCloudDetect && allowCloud))}
            onRescan={() => void runScan(text, vault)}
            onToggleEntity={(e) => setVault((v) => setEntityEnabled(v, e.id, !e.enabled))}
            onToggleType={(type, enabled) => setVault((v) => setTypeEnabled(v, type, enabled))}
            onMaskSelection={(value) => setVault((v) => addDetections(v, [{ text: value, type: 'CUSTOM', source: 'manual' }]))}
          />
          <Conversation
            turns={turns}
            vault={vault}
            busy={busy}
            strictLocal={strictLocal}
            onStrictLocal={setStrictLocal}
            preview={preview}
            onAsk={(label, instruction, weight) => void ask(label, instruction, weight)}
            ledger={ledger}
          />
        </main>
      )}

      <footer className="foot">
        <span>Built with Firebase AI Logic hybrid inference · Gemini Nano on-device, Gemini in the cloud</span>
        <span>Blindfold reduces what the cloud can see; always review the blindfolded copy before you ask.</span>
      </footer>
    </div>
  );
}
