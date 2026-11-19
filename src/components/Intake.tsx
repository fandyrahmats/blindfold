import { useRef, useState } from 'react';
import { noLocalModel } from '../lib/router';
import type { DeviceStatus } from '../lib/router';
import { SAMPLES } from '../lib/samples';
import type { SavedThread } from '../lib/store';

interface Props {
  configured: boolean;
  device: DeviceStatus;
  maxChars: number;
  /** Show the opt-in for cloud-assisted name detection (device has no local model). */
  cloudDetectOption: boolean;
  allowCloud: boolean;
  onAllowCloud: (allow: boolean) => void;
  imageBusy: boolean;
  notice: string | null;
  threads: SavedThread[];
  onStart: (text: string) => void;
  onImage: (file: File) => void;
  onOpenThread: (thread: SavedThread) => void;
  onDeleteThread: (thread: SavedThread) => void;
}

const when = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function Intake(props: Props) {
  const [draft, setDraft] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const tooLong = draft.length > props.maxChars;
  const onDevice = props.device === 'available';

  return (
    <main className="intake">
      <section className="hero">
        <p className="eyebrow">Hybrid AI with a privacy boundary you can see</p>
        <h1>
          Ask AI about documents you <span className="strike">can't show</span> AI.
        </h1>
        <p className="lede">
          Blindfold swaps names, companies, amounts and account numbers for placeholders on your device. The cloud model
          only ever works on the blindfolded copy, and the real values are put back locally when the answer arrives.
        </p>
      </section>

      <section className="card compose">
        <label htmlFor="doc" className="label">
          Paste a contract, email or statement
        </label>
        <textarea
          id="doc"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Nothing you paste here is sent anywhere. You review the blindfolded copy before any request is made."
          spellCheck={false}
        />
        <div className="compose-row">
          <button className="btn btn-primary" disabled={!draft.trim() || tooLong} onClick={() => props.onStart(draft)}>
            Blindfold it
          </button>
          <button
            className="btn"
            disabled={!props.configured || props.imageBusy}
            onClick={() => fileRef.current?.click()}
            title={
              !props.configured
                ? 'Connect Firebase to read screenshots'
                : onDevice
                  ? 'The image is read by the on-device model and never uploaded'
                  : `${noLocalModel(props.device)}: the image would be sent to the cloud model. You will be asked first.`
            }
          >
            {props.imageBusy ? 'Reading image…' : onDevice ? 'Read a screenshot on-device' : 'Read a screenshot'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) props.onImage(file);
            }}
          />
          <span className={`count ${tooLong ? 'over' : ''}`}>
            {draft.length.toLocaleString('en-US')} / {props.maxChars.toLocaleString('en-US')}
          </span>
        </div>
        {props.cloudDetectOption && (
          <label className="consent">
            <input type="checkbox" checked={props.allowCloud} onChange={(e) => props.onAllowCloud(e.target.checked)} />
            <span>
              {noLocalModel(props.device)}, so names are found by patterns only. Tick to also let the cloud model
              look for names. Emails, phones, amounts and account numbers are masked first, but names will be visible to
              the cloud during that one detection step.
            </span>
          </label>
        )}
        {props.notice && <p className="notice">{props.notice}</p>}
        <div className="samples">
          <span className="label">Or try a sample</span>
          {SAMPLES.map((s) => (
            <button key={s.id} className="sample" onClick={() => props.onStart(s.text)}>
              <strong>{s.label}</strong>
              <span>{s.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="how">
        <div>
          <span className="step">1</span>
          <h3>Blindfold on your device</h3>
          <p>Patterns and the on-device model find sensitive values. The original never leaves the browser.</p>
        </div>
        <div>
          <span className="step">2</span>
          <h3>Route each request</h3>
          <p>Light tasks stay on-device. Heavy reasoning goes to the cloud, working only on placeholders.</p>
        </div>
        <div>
          <span className="step">3</span>
          <h3>Restore locally</h3>
          <p>Answers come back with placeholders, and your vault puts the real values back on screen.</p>
        </div>
      </section>

      {props.threads.length > 0 && (
        <section className="history">
          <h2>Saved threads</h2>
          <p className="muted">Only blindfolded text is synced. Real values show on the device where a thread was created.</p>
          <ul>
            {props.threads.map((t) => (
              <li key={t.id}>
                <button className="thread-open" onClick={() => props.onOpenThread(t)}>
                  <strong>{t.title}</strong>
                  <span>
                    {t.turns.length} {t.turns.length === 1 ? 'answer' : 'answers'} · {t.protectedValues} protected ·{' '}
                    {when(t.updatedAt)}
                  </span>
                </button>
                <button className="link danger" onClick={() => props.onDeleteThread(t)} aria-label={`Delete ${t.title}`}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
