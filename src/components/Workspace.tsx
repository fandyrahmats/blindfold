import { useEffect, useRef, useState } from 'react';
import type { ShieldStats } from '../lib/pseudonymize';
import { TYPE_LABEL } from '../lib/types';
import type { Entity, EntityType, Segment } from '../lib/types';
import { Bar, barLabel } from './Rich';

export type ScanState =
  | { state: 'idle' }
  | { state: 'scanning'; done: number; total: number }
  | { state: 'done'; source: 'on_device' | 'in_cloud' | null; found: number; failed: number }
  | { state: 'error'; message: string };

interface Props {
  segments: Segment[];
  stats: ShieldStats;
  scan: ScanState;
  /** Opened on a device that does not hold the vault: only the blindfolded copy exists here. */
  foreign: boolean;
  canRescan: boolean;
  onRescan: () => void;
  onToggleEntity: (entity: Entity) => void;
  onToggleType: (type: EntityType, enabled: boolean) => void;
  onMaskSelection: (text: string) => void;
}

function ScanLine({ scan, canRescan, onRescan }: Pick<Props, 'scan' | 'canRescan' | 'onRescan'>) {
  let message: string;
  if (scan.state === 'scanning') {
    message = `Looking for names and companies… ${Math.min(scan.done + 1, scan.total)} of ${scan.total}`;
  } else if (scan.state === 'error') {
    message = `Name detection failed: ${scan.message} Patterns are still applied.`;
  } else if (scan.state === 'done' && scan.source === 'on_device') {
    message = `Names found by Gemini Nano on this device, plus patterns.${scan.failed ? ` ${scan.failed} section(s) could not be scanned.` : ''}`;
  } else if (scan.state === 'done' && scan.source === 'in_cloud') {
    message = 'Names found by the cloud model on pattern-masked text (you opted in), plus patterns.';
  } else {
    message = 'Pattern shield only. Names without a title or company suffix may be missed: select any text to mask it.';
  }
  return (
    <p className={`scanline ${scan.state === 'error' ? 'is-error' : ''}`} role="status">
      {scan.state === 'scanning' && <i className="dot pulse" />}
      <span>{message}</span>
      {canRescan && scan.state !== 'scanning' && (
        <button className="link" onClick={onRescan}>
          Scan again
        </button>
      )}
    </p>
  );
}

export function Workspace(props: Props) {
  const { segments, stats, foreign } = props;
  const [selection, setSelection] = useState('');
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    const ratio = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
    to.scrollTop = ratio * (to.scrollHeight - to.clientHeight);
    requestAnimationFrame(() => (syncing.current = false));
  };

  // Track text selected inside the device pane so it can be blindfolded by hand.
  useEffect(() => {
    const readSelection = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim().replace(/\s+/g, ' ') ?? '';
      const inside =
        !!sel?.anchorNode && !!sel.focusNode && !!leftRef.current?.contains(sel.anchorNode) && leftRef.current.contains(sel.focusNode);
      setSelection(inside && text.length >= 2 && text.length <= 80 ? text : '');
    };
    document.addEventListener('selectionchange', readSelection);
    return () => document.removeEventListener('selectionchange', readSelection);
  }, []);

  return (
    <section className="workspace" aria-label="Document">
      <div className="shield">
        <div className="shield-count">
          <strong>{stats.protectedValues}</strong>
          <span>
            {stats.protectedValues === 1 ? 'value' : 'values'} blindfolded
            {stats.allowedValues > 0 && ` · ${stats.allowedValues} let through`}
          </span>
        </div>
        <div className="chips">
          {stats.byType.map((t) => {
            const on = t.enabled > 0;
            return (
              <button
                key={t.type}
                className={`chip ${on ? 'on' : ''}`}
                aria-pressed={on}
                disabled={foreign}
                onClick={() => props.onToggleType(t.type, !on)}
                title={on ? `Click to let all ${TYPE_LABEL[t.type].toLowerCase()} through` : `Click to blindfold all ${TYPE_LABEL[t.type].toLowerCase()}`}
              >
                {TYPE_LABEL[t.type]} <b>{t.total}</b>
              </button>
            );
          })}
        </div>
      </div>
      {!foreign && <ScanLine scan={props.scan} canRescan={props.canRescan} onRescan={props.onRescan} />}

      <div className="panes">
        <article className="pane pane-device">
          <header>
            <h2>
              <i className="dot" /> On this device
            </h2>
            {selection ? (
              <button
                className="btn btn-small"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  props.onMaskSelection(selection);
                  setSelection('');
                  window.getSelection()?.removeAllRanges();
                }}
              >
                Blindfold “{selection.length > 28 ? `${selection.slice(0, 28)}…` : selection}”
              </button>
            ) : (
              <span className="hint">{foreign ? 'Vault not on this device' : 'Click a highlight to let it through · select text to blindfold it'}</span>
            )}
          </header>
          <div className="doc" ref={leftRef} onScroll={() => sync(leftRef.current, rightRef.current)}>
            {foreign ? (
              <p className="foreign">
                This thread was created on another device. The real values live only in that device's local vault, so
                all you (and Firestore) have here is the blindfolded copy on the right.
              </p>
            ) : (
              segments.map((s, i) =>
                s.entity ? (
                  <mark
                    key={i}
                    className={s.entity.enabled ? 'hl' : 'hl off'}
                    role="button"
                    tabIndex={0}
                    title={`${barLabel(s.entity)} · ${s.entity.enabled ? 'blindfolded' : 'let through'} · click to change`}
                    onClick={() => props.onToggleEntity(s.entity!)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        props.onToggleEntity(s.entity!);
                      }
                    }}
                  >
                    {s.text}
                  </mark>
                ) : (
                  <span key={i}>{s.text}</span>
                ),
              )
            )}
          </div>
        </article>

        <div className="boundary" aria-hidden="true">
          <span>device boundary</span>
        </div>

        <article className="pane pane-cloud">
          <header>
            <h2>
              <i className="dot" /> What the cloud sees
            </h2>
            <span className="hint">The only copy that can leave</span>
          </header>
          <div className="doc" ref={rightRef} onScroll={() => sync(rightRef.current, leftRef.current)}>
            {segments.map((s, i) =>
              s.entity?.enabled ? <Bar key={i} entity={s.entity} /> : <span key={i}>{s.text}</span>,
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
