/**
 * Pattern shield: deterministic detectors that run instantly on every device,
 * with or without a local model. They catch structured identifiers (emails,
 * phones, IBANs, cards, amounts) and a few high-precision name cues.
 * The on-device model then adds what patterns cannot see: free-form names,
 * companies and addresses.
 */
import type { Detection, EntityType } from './types';

interface Hit {
  start: number;
  end: number;
  text: string;
  type: EntityType;
  /** Lower wins when two hits of equal length overlap. */
  priority: number;
}

interface Rule {
  type: EntityType;
  priority: number;
  re: RegExp;
  /** Capture group that holds the value (default: whole match). */
  group?: number;
  validate?: (value: string) => boolean;
  /** Strip trailing sentence punctuation from the match. */
  trimTail?: boolean;
  /** Drop leading words that only start the sentence ("Between Acme Inc" -> "Acme Inc"). */
  trimHead?: Set<string>;
}

const CURRENCY = 'USD|EUR|GBP|IDR|SGD|AUD|CAD|JPY|CHF|MYR|INR';
const NAME = "\\p{Lu}[\\p{L}'’-]+";
const ORG_SUFFIX =
  'Inc|LLC|L\\.L\\.C|Ltd|Limited|GmbH|Corp|Corporation|PLC|LLP|Pty|AG|B\\.V|BV|S\\.A|Sdn Bhd|Tbk|Co';
const ORG_KIND =
  'Bank|Group|Holdings|Partners|University|Hospital|Clinic|Insurance|Finance|Capital|Ventures|Foundation|Associates|Logistics|Properties';
const NOT_AN_ORG_START = new Set([
  'the', 'a', 'an', 'our', 'your', 'my', 'this', 'that', 'their', 'his', 'her', 'its',
  'between', 'with', 'from', 'to', 'by', 'for', 'at', 'in', 'on', 'of', 'and', 'or', 'but', 'as', 'if', 'when',
  'dear', 'hi', 'hello', 'signed', 'payee', 'pay', 'contact', 'call', 'see', 'both', 'neither', 'either',
]);
const NOT_A_NAME = new Set(
  ['sir', 'madam', 'team', 'all', 'there', 'everyone', 'customer', 'client', 'colleagues', 'friend', 'support'],
);

const digits = (s: string) => s.replace(/\D/g, '');

function luhn(value: string): boolean {
  const d = digits(value);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

function looksLikePhone(value: string): boolean {
  const v = value.trim();
  if (/^\d{4}[-. ]\d{2}[-. ]\d{2}$/.test(v)) return false; // ISO-like date
  if (/^\d{1,2}[-. ]\d{1,2}[-. ]\d{2,4}$/.test(v)) return false; // d-m-y date
  if (/^(?:19|20)\d{2}[-. ](?:19|20)\d{2}$/.test(v)) return false; // year range
  const n = digits(v).length;
  if (n > 15) return false;
  if (/^\+|\(/.test(v)) return n >= 8;
  return n >= 10;
}

const RULES: Rule[] = [
  { type: 'EMAIL', priority: 1, re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, trimTail: true },
  { type: 'URL', priority: 2, re: /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/giu, trimTail: true },
  {
    type: 'IBAN',
    priority: 0,
    re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/gu,
    validate: (v) => v.replace(/\s/g, '').length >= 15,
  },
  { type: 'CARD', priority: 0, re: /\b\d(?:[ -]?\d){12,18}\b/gu, validate: luhn },
  { type: 'ID', priority: 3, re: /\b\d{3}-\d{2}-\d{4}\b/gu },
  {
    type: 'PHONE',
    priority: 4,
    re: /(?<![\w+])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?)?\d{2,4}(?:[ .-]\d{2,4}){1,3}(?!\w)/gu,
    validate: looksLikePhone,
  },
  {
    type: 'MONEY',
    priority: 5,
    re: new RegExp(
      `(?:US\\$|[$€£¥]|\\b(?:${CURRENCY})\\s?|\\bRp\\.?\\s?)\\s?\\d[\\d,.]*(?:\\s?(?:million|billion|thousand)\\b|[kKmM]\\b)?`,
      'gu',
    ),
    trimTail: true,
  },
  {
    type: 'MONEY',
    priority: 5,
    re: new RegExp(`\\b\\d[\\d,.]*\\s?(?:${CURRENCY}|dollars|euros|pounds|rupiah)\\b`, 'giu'),
  },
  {
    // Labelled references: "Invoice no. INV-2041", "Account: 0098-221", "Passport X1234567"
    type: 'ID',
    priority: 7,
    re: /\b(?:account|acct|a\/c|routing|sort code|invoice|policy|passport|tax id|vat|ssn|nik|npwp|ref(?:erence)?|order|case|claim|contract|employee id|customer id)\s*(?:no\.?|number|num|#|id)?\s*[:#]?\s*((?=[A-Z0-9/-]*\d)[A-Z0-9][A-Z0-9/-]{4,24})\b/dgiu,
    group: 1,
  },
  { type: 'ACCOUNT', priority: 6, re: /\b\d{8,19}\b/gu },
  {
    type: 'PERSON',
    priority: 8,
    re: new RegExp(`\\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof)\\.?\\s+(${NAME}(?:[ \\t]+${NAME}){0,2})`, 'dgu'),
    group: 1,
  },
  {
    // Labelled names: "Account holder: Jonah Whitfield", "Attn: Priya Raman"
    type: 'PERSON',
    priority: 8,
    re: new RegExp(
      `\\b(?:Account holder|Customer name|Name|Attn|Attention|Contact|Bill to|Payee|Beneficiary|Prepared for|Signed by)[ \\t]*:[ \\t]*(${NAME}(?:[ \\t]+${NAME}){0,2})`,
      'dgu',
    ),
    group: 1,
  },
  {
    type: 'PERSON',
    priority: 9,
    re: new RegExp(`(?:^|\\n)[ \\t]*(?:Dear|Hi|Hello|Hey)[ \\t]+(${NAME}(?:[ \\t]+${NAME})?)[ \\t]*[,:!]`, 'dgu'),
    group: 1,
    validate: (v) => !NOT_A_NAME.has(v.split(/\s+/)[0].toLowerCase()),
  },
  {
    type: 'PERSON',
    priority: 9,
    re: new RegExp(
      `(?:Regards|Sincerely|Best|Thanks|Thank you|Cheers|Best regards|Kind regards|Warm regards|Yours truly),?[ \\t]*\\n+[ \\t]*(${NAME}(?:[ \\t]+${NAME}){0,2})[ \\t]*(?=\\n|$)`,
      'dgu',
    ),
    group: 1,
    validate: (v) => !NOT_A_NAME.has(v.split(/\s+/)[0].toLowerCase()),
  },
  {
    type: 'ORG',
    priority: 8,
    re: new RegExp(
      `\\b((?:\\p{Lu}[\\p{L}\\p{N}'’-]*|&)(?:[ \\t]+(?:\\p{Lu}[\\p{L}\\p{N}'’-]*|&|and|of)){0,4}[ \\t]+(?:${ORG_SUFFIX}))(?![\\p{L}\\p{N}])`,
      'dgu',
    ),
    group: 1,
    trimHead: NOT_AN_ORG_START,
  },
  {
    // Organizations named by kind: "First Cascade Bank", "Northgate Auto Finance"
    type: 'ORG',
    priority: 9,
    re: new RegExp(
      `\\b(\\p{Lu}[\\p{L}\\p{N}'’-]*(?:[ \\t]+(?:\\p{Lu}[\\p{L}\\p{N}'’-]*|&|and|of)){0,3}[ \\t]+(?:${ORG_KIND}))(?![\\p{L}\\p{N}])`,
      'dgu',
    ),
    group: 1,
    trimHead: NOT_AN_ORG_START,
  },
  {
    type: 'ORG',
    priority: 8,
    re: /\b(PT\.?[ \t]+\p{Lu}[\p{L}\p{N}'’-]*(?:[ \t]+\p{Lu}[\p{L}\p{N}'’-]*){0,3})/dgu,
    group: 1,
  },
];

function run(text: string, rule: Rule): Hit[] {
  const hits: Hit[] = [];
  rule.re.lastIndex = 0;
  for (const m of text.matchAll(rule.re)) {
    let start = m.index;
    let value = m[0];
    if (rule.group) {
      const span = m.indices?.[rule.group];
      if (!span) continue;
      [start] = span;
      value = text.slice(span[0], span[1]);
    }
    if (rule.trimHead) {
      for (;;) {
        const head = /^(\S+)\s+/u.exec(value);
        if (!head || !rule.trimHead.has(head[1].toLowerCase())) break;
        start += head[0].length;
        value = value.slice(head[0].length);
      }
      // What is left must still be a name plus its suffix, not the suffix alone.
      if (!/\s/u.test(value)) continue;
    }
    if (rule.trimTail) value = value.replace(/[.,;:!?]+$/u, '');
    value = value.replace(/\s+$/u, '');
    if (value.length < 2) continue;
    if (rule.validate && !rule.validate(value)) continue;
    hits.push({ start, end: start + value.length, text: value, type: rule.type, priority: rule.priority });
  }
  return hits;
}

/** Keep the longest hit when hits overlap; ties go to the lower priority number. */
function resolve(hits: Hit[]): Hit[] {
  const ranked = [...hits].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.priority - b.priority || a.start - b.start,
  );
  const kept: Hit[] = [];
  for (const h of ranked) {
    if (!kept.some((k) => h.start < k.end && k.start < h.end)) kept.push(h);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function detectPatterns(text: string): Detection[] {
  const hits = resolve(RULES.flatMap((rule) => run(text, rule)));
  return hits.map((h) => ({ text: h.text, type: h.type, source: 'pattern' as const }));
}
