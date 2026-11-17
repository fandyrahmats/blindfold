import { useEffect, useRef, useState } from 'react';
import { TASKS } from '../lib/prompts';
import type { TaskPreset } from '../lib/prompts';
import type { Route, RouteMode } from '../lib/router';
import type { VaultState } from '../lib/types';
import { Rich } from './Rich';

export interface Turn {
  id: string;
  label: string;
  /** Blindfolded request. */
  question: string;
  /** Exact string handed to the model. Empty for threads restored from Firestore. */
  prompt: string;
  /** Blindfolded answer, exactly as the model wrote it. */
  answer: string;
  status: 'streaming' | 'done' | 'error' | 'blocked';
  mode: RouteMode;
  reason: string;
  source?: 'on_device' | 'in_cloud';
  cloudModel?: string;
  error?: string;
  ms?: number;
  at: number;
}

interface Props {
  turns: Turn[];
  vault: VaultState;
  busy: boolean;
  strictLocal: boolean;
  onStrictLocal: (on: boolean) => void;
  preview: (weight: TaskPreset['weight']) => Route;
  onAsk: (label: string, instruction: string, weight: TaskPreset['weight']) => void;
  ledger: { cloudChars: number; cloudRuns: number; deviceRuns: number; protectedValues: number; namesSeenByCloud: boolean };
}

const MODE_LABEL: Record<RouteMode, string> = {
  only_on_device: 'ONLY_ON_DEVICE',
  prefer_on_device: 'PREFER_ON_DEVICE',
  prefer_in_cloud: 'PREFER_IN_CLOUD',
  only_in_cloud: 'ONLY_IN_CLOUD',
  blocked: 'not sent',
};

function RouteTag({ route }: { route: Route }) {
  const cls = route.expected === 'device' ? 'tag-device' : route.expected === 'cloud' ? 'tag-cloud' : 'tag-blocked';
  const text = route.expected === 'device' ? 'on-device' : route.expected === 'cloud' ? 'cloud, blindfolded' : 'unavailable';
  return <span className={`tag ${cls}`}>{text}</span>;
}

function TurnCard({ turn, vault }: { turn: Turn; vault: VaultState }) {
  const [real, setReal] = useState(true);
  const sourceTag =
    turn.source === 'on_device' ? (
      <span className="tag tag-device">Ran on this device</span>
    ) : turn.source === 'in_cloud' ? (
      <span className="tag tag-cloud">Ran in the cloud{turn.cloudModel ? ` · ${turn.cloudModel}` : ''}</span>
    ) : turn.status === 'streaming' ? (
      <span className="tag">
        <i className="dot pulse" /> Working…
      </span>
    ) : turn.status === 'blocked' ? (
      <span className="tag tag-blocked">Not sent</span>
    ) : (
      <span className="tag tag-blocked">Failed</span>
    );

  return (
    <article className={`turn turn-${turn.status}`}>
      <header>
        <h3>{turn.label}</h3>
        <div className="turn-meta">
          {sourceTag}
          <span className="mode" title={turn.reason}>
            {MODE_LABEL[turn.mode]}
          </span>
          {turn.ms !== undefined && <span className="mode">{(turn.ms / 1000).toFixed(1)}s</span>}
        </div>
      </header>
      <p className="reason">{turn.reason}</p>

      {turn.answer && <Rich text={turn.answer} vault={vault} real={real} />}
      {turn.status === 'error' && <p className="notice">{turn.error}</p>}

      <footer>
        {turn.answer && (
          <div className="seg" role="group" aria-label="Answer view">
            <button className={real ? 'on' : ''} aria-pressed={real} onClick={() => setReal(true)}>
              Real values
            </button>
            <button className={!real ? 'on' : ''} aria-pressed={!real} onClick={() => setReal(false)}>
              As the model wrote it
            </button>
          </div>
        )}
        {turn.prompt && (
          <details className="payload">
            <summary>
              {turn.status === 'blocked' ? 'Payload that would be sent' : 'Exact payload sent'} ·{' '}
              {turn.prompt.length.toLocaleString('en-US')} characters
            </summary>
            <pre>{turn.prompt}</pre>
          </details>
        )}
      </footer>
    </article>
  );
}

export function Conversation(props: Props) {
  const [question, setQuestion] = useState('');
  const { ledger } = props;
  const turnsRef = useRef<HTMLDivElement>(null);
  const count = props.turns.length;
  // Bring the newest answer into view when a request starts.
  useEffect(() => {
    if (count > 0) turnsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [count]);
  const submit = () => {
    const q = question.trim();
    if (!q || props.busy) return;
    props.onAsk(q.length > 64 ? `${q.slice(0, 64)}…` : q, q, 'heavy');
    setQuestion('');
  };

  return (
    <section className="conversation" aria-label="Ask">
      <div className="ask card">
        <div className="presets">
          {TASKS.map((task) => (
            <button
              key={task.id}
              className="preset"
              disabled={props.busy}
              onClick={() => props.onAsk(task.label, task.instruction, task.weight)}
              title={props.preview(task.weight).reason}
            >
              <strong>{task.label}</strong>
              <RouteTag route={props.preview(task.weight)} />
            </button>
          ))}
        </div>
        <form
          className="ask-row"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything about this document. Real names in your question are blindfolded too."
            aria-label="Your question"
          />
          <button className="btn btn-primary" disabled={!question.trim() || props.busy}>
            Ask
          </button>
        </form>
        <label className="switch">
          <input type="checkbox" checked={props.strictLocal} onChange={(e) => props.onStrictLocal(e.target.checked)} />
          <span>
            <strong>Strict local</strong> · never use the cloud, even blindfolded
          </span>
        </label>
      </div>

      <div className="turns" ref={turnsRef}>
        {[...props.turns].reverse().map((turn) => (
          <TurnCard key={turn.id} turn={turn} vault={props.vault} />
        ))}
      </div>

      <dl className="ledger" aria-label="Privacy ledger">
        <div>
          <dt>Protected values sent to the cloud</dt>
          <dd className={ledger.namesSeenByCloud ? '' : 'good'}>
            {ledger.namesSeenByCloud ? 'Names, once' : '0'}
            <small>
              {ledger.namesSeenByCloud
                ? 'you opted in to cloud-assisted detection'
                : `of ${ledger.protectedValues}, checked before every request`}
            </small>
          </dd>
        </div>
        <div>
          <dt>Blindfolded text sent to the cloud</dt>
          <dd>
            {ledger.cloudChars.toLocaleString('en-US')}
            <small>characters, in {ledger.cloudRuns} {ledger.cloudRuns === 1 ? 'request' : 'requests'}</small>
          </dd>
        </div>
        <div>
          <dt>Answered on this device</dt>
          <dd>
            {ledger.deviceRuns}
            <small>{ledger.deviceRuns === 1 ? 'request' : 'requests'}, free and offline-capable</small>
          </dd>
        </div>
      </dl>
    </section>
  );
}
