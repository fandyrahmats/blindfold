/**
 * The blindfold itself: a reversible mapping between real values and
 * placeholders. Everything here is pure and runs locally; the vault is the
 * only place where real values and placeholders meet.
 */
import { ENTITY_TYPES } from './types';
import type { Detection, Entity, EntityType, Segment, VaultState } from './types';

export const emptyVault = (): VaultState => ({ entities: [], counters: {} });

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir', 'madam']);
const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'la', 'le', 'di', 'da', 'bin', 'binti', 'al', 'el', 'the', 'and', 'of']);
/** Role words a model may return as "entities"; masking them only hurts the answer. */
const GENERIC = new Set(
  [
    'client', 'contractor', 'company', 'customer', 'supplier', 'vendor', 'party', 'parties', 'agreement',
    'contract', 'services', 'service', 'employee', 'employer', 'landlord', 'tenant', 'buyer', 'seller',
    'bank', 'invoice', 'statement', 'project', 'team', 'manager', 'director', 'recipient', 'sender',
    'user', 'account', 'date', 'total', 'balance', 'payment', 'fee', 'fees', 'n/a', 'none', 'unknown',
  ],
);

const normalize = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Mr. Daniel Okafor" from a model is the same person as "Daniel Okafor". */
const TITLE_PREFIX = /^(?:mr|mrs|ms|miss|mx|dr|prof|sir|madam)\.?\s+/i;

/** Types the pattern shield finds exactly; a model's wider span around one of these is redundant. */
const STRUCTURED = new Set<EntityType>(['EMAIL', 'PHONE', 'URL', 'IBAN', 'CARD', 'ACCOUNT', 'MONEY', 'ID']);

/** True if `phrase` occurs in `text` on word boundaries (both already normalized). */
const containsPhrase = (text: string, phrase: string) =>
  phrase.length > 0 && new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(phrase)}(?![\\p{L}\\p{N}_])`, 'u').test(text);

function isMaskable(value: string, d: Detection): boolean {
  if (value.length < 2 || value.length > 120) return false;
  if (!/[\p{L}\p{N}]/u.test(value)) return false;
  if (d.source === 'pattern' || d.source === 'manual') return true;
  // Model output gets a stricter filter: it can hallucinate or over-reach.
  if (value.length < 3 && !/\d/.test(value)) return false;
  return !GENERIC.has(normalize(value));
}

/** "Priya Raman" also protects a bare "Priya" or "Raman" later in the text. */
function nameAliases(value: string): string[] {
  const parts = value.split(/\s+/);
  if (parts.length < 2) return [];
  return parts
    .map((p) => p.replace(/[.,]/g, ''))
    .filter((p) => p.length >= 3 && /^\p{Lu}/u.test(p) && !TITLES.has(p.toLowerCase()) && !PARTICLES.has(p.toLowerCase()));
}

/** Adds new detections to the vault. Existing placeholders never change, so earlier answers stay valid. */
export function addDetections(state: VaultState, detections: Detection[]): VaultState {
  const entities = [...state.entities];
  const counters = { ...state.counters };
  const known = new Set<string>();
  for (const e of entities) {
    known.add(normalize(e.value));
    for (const a of e.aliases) known.add(normalize(a));
  }
  for (const d of detections) {
    const fromModel = d.source !== 'pattern' && d.source !== 'manual';
    let value = d.text.trim().replace(/\s+/g, ' ');
    // Models often copy the sentence's punctuation ("Harbor Studio Ltd."), which would
    // otherwise give one company two placeholders.
    if (fromModel) value = value.replace(/[.,;:]+$/, '');
    if (fromModel && d.type === 'PERSON') value = value.replace(TITLE_PREFIX, '');
    const key = normalize(value);
    if (!isMaskable(value, d) || known.has(key)) continue;
    if (fromModel) {
      // A label around an exact identifier ("IBAN GB29 ...", "contract no. MO-17") adds
      // nothing: the identifier is already masked, and the label helps the answer.
      if (entities.some((e) => STRUCTURED.has(e.type) && containsPhrase(key, normalize(e.value)))) continue;
      // A fuller form of a known name ("Marcus Lindqvist" when only "Marcus" was known) is
      // MORE sensitive, never redundant: the entity grows to the full name and keeps its
      // placeholder, and the short form lives on as an alias.
      const shorter = entities.findIndex((e) => e.type === d.type && containsPhrase(key, normalize(e.value)));
      if (shorter >= 0) {
        const e = entities[shorter];
        const parts = d.type === 'PERSON' ? nameAliases(value).filter((a) => !known.has(normalize(a))) : [];
        const aliases = [...new Set([...e.aliases, e.value, ...parts])];
        entities[shorter] = { ...e, value, aliases };
        known.add(key);
        for (const a of aliases) known.add(normalize(a));
        continue;
      }
      // A shorter form of a known name ("Meridian Outfitters" for "Meridian Outfitters Inc")
      // becomes an alias, so both spellings share one placeholder.
      const longer = entities.findIndex((e) => e.type === d.type && containsPhrase(normalize(e.value), key));
      if (longer >= 0) {
        if (value.length >= 3) {
          entities[longer] = { ...entities[longer], aliases: [...entities[longer].aliases, value] };
          known.add(key);
        }
        continue;
      }
    }
    const n = (counters[d.type] ?? 0) + 1;
    counters[d.type] = n;
    const aliases = d.type === 'PERSON' ? nameAliases(value).filter((a) => !known.has(normalize(a))) : [];
    entities.push({ id: `${d.type}_${n}`, type: d.type, value, aliases, source: d.source, enabled: true });
    known.add(key);
    for (const a of aliases) known.add(normalize(a));
  }
  return { entities, counters };
}

export function setEntityEnabled(state: VaultState, id: string, enabled: boolean): VaultState {
  return { ...state, entities: state.entities.map((e) => (e.id === id ? { ...e, enabled } : e)) };
}

export function setTypeEnabled(state: VaultState, type: EntityType, enabled: boolean): VaultState {
  return { ...state, entities: state.entities.map((e) => (e.type === type ? { ...e, enabled } : e)) };
}

interface Span {
  start: number;
  end: number;
  entity: Entity;
  alias: boolean;
}

function occurrences(text: string, needle: string, caseSensitive: boolean): Array<[number, number]> {
  const body = escapeRe(needle).replace(/\s+/g, '\\s+');
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, caseSensitive ? 'gu' : 'giu');
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(re)) out.push([m.index, m.index + m[0].length]);
  return out;
}

/**
 * Splits the original text into plain and protected segments.
 * Every entity (enabled or not) is located so the UI can show what was found;
 * only enabled ones are replaced by `maskText`.
 */
export function segment(text: string, state: VaultState): Segment[] {
  const spans: Span[] = [];
  for (const entity of state.entities) {
    for (const [start, end] of occurrences(text, entity.value, false)) spans.push({ start, end, entity, alias: false });
    for (const alias of entity.aliases) {
      for (const [start, end] of occurrences(text, alias, true)) spans.push({ start, end, entity, alias: true });
    }
  }
  // Longest span wins; a value beats an alias; then earliest.
  spans.sort((a, b) => b.end - b.start - (a.end - a.start) || Number(a.alias) - Number(b.alias) || a.start - b.start);
  const kept: Span[] = [];
  for (const s of spans) {
    if (!kept.some((k) => s.start < k.end && k.start < s.end)) kept.push(s);
  }
  kept.sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  let cursor = 0;
  for (const s of kept) {
    if (s.start > cursor) out.push({ text: text.slice(cursor, s.start) });
    out.push({ text: text.slice(s.start, s.end), entity: s.entity });
    cursor = s.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}

export const placeholder = (entity: Entity) => `[${entity.id}]`;

/** The only version of the document that is ever allowed to leave the device. */
export function maskSegments(segments: Segment[]): string {
  return segments.map((s) => (s.entity?.enabled ? placeholder(s.entity) : s.text)).join('');
}

export function maskText(text: string, state: VaultState): string {
  return maskSegments(segment(text, state));
}

const PLACEHOLDER_RE = new RegExp(`\\[\\s*((?:${ENTITY_TYPES.join('|')})_\\d+)\\s*\\]|\\b((?:${ENTITY_TYPES.join('|')})_\\d+)\\b`, 'g');

/**
 * Splits a model answer into plain text and placeholder segments so the UI can
 * show either the real value (restored locally) or what the model actually wrote.
 * Tolerates models that drop the brackets.
 */
export function rehydrate(answer: string, state: VaultState, keepUnknown = false): Segment[] {
  const byId = new Map(state.entities.map((e) => [e.id, e]));
  const out: Segment[] = [];
  let cursor = 0;
  for (const m of answer.matchAll(PLACEHOLDER_RE)) {
    const id = m[1] ?? m[2];
    let entity = byId.get(id);
    if (!entity && keepUnknown) {
      // No local value for this placeholder (the vault lives on another device): keep it as a bar.
      entity = {
        id,
        type: id.slice(0, id.lastIndexOf('_')) as EntityType,
        value: '[' + id + ']',
        aliases: [],
        source: 'pattern',
        enabled: true,
        ghost: true,
      };
      byId.set(id, entity);
    }
    if (!entity) continue;
    if (m.index > cursor) out.push({ text: answer.slice(cursor, m.index) });
    out.push({ text: m[0], entity });
    cursor = m.index + m[0].length;
  }
  if (cursor < answer.length) out.push({ text: answer.slice(cursor) });
  return out;
}

export function rehydrateToString(answer: string, state: VaultState): string {
  return rehydrate(answer, state)
    .map((s) => (s.entity ? s.entity.value : s.text))
    .join('');
}

export interface ShieldStats {
  /** Distinct values currently replaced by placeholders. */
  protectedValues: number;
  /** Total replaced occurrences in the document. */
  protectedOccurrences: number;
  /** Values detected but let through by the user. */
  allowedValues: number;
  byType: Array<{ type: EntityType; total: number; enabled: number }>;
}

export function shieldStats(segments: Segment[]): ShieldStats {
  const seen = new Map<string, Entity>();
  let protectedOccurrences = 0;
  for (const s of segments) {
    if (!s.entity) continue;
    seen.set(s.entity.id, s.entity);
    if (s.entity.enabled) protectedOccurrences++;
  }
  const entities = [...seen.values()];
  const byType = ENTITY_TYPES.map((type) => {
    const ofType = entities.filter((e) => e.type === type);
    return { type, total: ofType.length, enabled: ofType.filter((e) => e.enabled).length };
  }).filter((t) => t.total > 0);
  return {
    protectedValues: entities.filter((e) => e.enabled).length,
    protectedOccurrences,
    allowedValues: entities.filter((e) => !e.enabled).length,
    byType,
  };
}

/** True if any protected real value appears verbatim in `payload`. Used as a last-line check before sending. */
export function findLeaks(payload: string, state: VaultState): Entity[] {
  return state.entities.filter(
    (e) => e.enabled && occurrences(payload, e.value, false).length > 0,
  );
}
