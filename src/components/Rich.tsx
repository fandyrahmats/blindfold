import type { ReactNode } from 'react';
import { rehydrate } from '../lib/pseudonymize';
import type { Entity, VaultState } from '../lib/types';

export const barLabel = (entity: Entity) => entity.id.replace('_', ' ');

/** A placeholder drawn as a redaction bar: what the cloud model sees instead of the real value. */
export function Bar({ entity }: { entity: Entity }) {
  return (
    <span className="bar" title={`Placeholder for a protected value (${entity.type.toLowerCase()})`}>
      {barLabel(entity)}
    </span>
  );
}

function withEntities(text: string, vault: VaultState, real: boolean, key: string): ReactNode[] {
  return rehydrate(text, vault).map((seg, i) => {
    if (!seg.entity) return seg.text;
    return real ? (
      <span className="restored" key={`${key}-${i}`} title={`${barLabel(seg.entity)} · restored on this device`}>
        {seg.entity.value}
      </span>
    ) : (
      <Bar entity={seg.entity} key={`${key}-${i}`} />
    );
  });
}

function inline(text: string, vault: VaultState, real: boolean, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let cursor = 0;
  let n = 0;
  for (const m of text.matchAll(/\*\*(.+?)\*\*/g)) {
    if (m.index > cursor) out.push(...withEntities(text.slice(cursor, m.index), vault, real, `${key}-t${n}`));
    out.push(<strong key={`${key}-b${n}`}>{withEntities(m[1], vault, real, `${key}-s${n}`)}</strong>);
    cursor = m.index + m[0].length;
    n++;
  }
  if (cursor < text.length) out.push(...withEntities(text.slice(cursor), vault, real, `${key}-t${n}`));
  return out;
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
const HEADING = /^\s*#{1,4}\s+/;

/**
 * Renders a model answer. With `real` on, placeholders are swapped back to the
 * real values from the local vault; with it off you see exactly what the model wrote.
 */
export function Rich({ text, vault, real }: { text: string; vault: VaultState; real: boolean }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const k = `p${blocks.length}`;
    blocks.push(
      <p key={k}>
        {para.flatMap((line, i) => [
          ...(i ? [<br key={`${k}-br${i}`} />] : []),
          ...inline(line, vault, real, `${k}-${i}`),
        ])}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    const k = `l${blocks.length}`;
    blocks.push(
      <ul key={k}>
        {list.map((item, i) => (
          <li key={`${k}-${i}`}>{inline(item, vault, real, `${k}-${i}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const line of lines) {
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (HEADING.test(line)) {
      flushPara();
      flushList();
      const k = `h${blocks.length}`;
      blocks.push(<h4 key={k}>{inline(line.replace(HEADING, ''), vault, real, k)}</h4>);
    } else if (BULLET.test(line)) {
      flushPara();
      list.push(line.replace(BULLET, ''));
    } else if (list.length && /^\s{2,}\S/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className="rich">{blocks}</div>;
}
