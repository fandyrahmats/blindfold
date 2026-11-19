import { describe, expect, it } from 'vitest';
import { estimateTokens, splitIntoChunks } from './chunk';
import { detectPatterns } from './detectors';
import {
  addDetections,
  emptyVault,
  findLeaks,
  maskText,
  rehydrate,
  rehydrateToString,
  segment,
  setEntityEnabled,
  setTypeEnabled,
  shieldStats,
} from './pseudonymize';
import { decideRoute } from './router';
import type { RouteInput } from './router';
import { SAMPLES } from './samples';
import type { Detection } from './types';

const find = (text: string) => detectPatterns(text).map((d) => `${d.type}:${d.text}`);

describe('pattern shield', () => {
  it('finds structured identifiers', () => {
    const hits = find(
      'Mail daniel.okafor@meridian-outfitters.example or call +1 (415) 555-0134. See https://example.com/pay?id=7.',
    );
    expect(hits).toContain('EMAIL:daniel.okafor@meridian-outfitters.example');
    expect(hits).toContain('PHONE:+1 (415) 555-0134');
    expect(hits).toContain('URL:https://example.com/pay?id=7');
  });

  it('classifies cards with a Luhn check and keeps IBANs whole', () => {
    const hits = find('Card 4539 1488 0343 6467, IBAN GB29 NWBK 6016 1331 9268 19, account 730055219846.');
    expect(hits).toContain('CARD:4539 1488 0343 6467');
    expect(hits).toContain('IBAN:GB29 NWBK 6016 1331 9268 19');
    expect(hits).toContain('ACCOUNT:730055219846');
    expect(hits.filter((h) => h.startsWith('PHONE'))).toEqual([]);
  });

  it('finds amounts in several notations', () => {
    const hits = find('Fee of $18,500, then EUR 2.400,50 and 300 USD, capped at Rp 12.500.000. Roughly $2k.');
    expect(hits).toContain('MONEY:$18,500');
    expect(hits).toContain('MONEY:EUR 2.400,50');
    expect(hits).toContain('MONEY:300 USD');
    expect(hits).toContain('MONEY:Rp 12.500.000');
    expect(hits).toContain('MONEY:$2k');
  });

  it('does not mistake dates and plain numbers for phones', () => {
    const hits = find('Due 2026-11-18, signed 03-11-2026, valid 2024-2026, clause 12.5, total 1,000 units.');
    expect(hits.filter((h) => h.startsWith('PHONE'))).toEqual([]);
  });

  it('uses high-precision cues for names and companies', () => {
    const hits = find('Dear Tomas,\nPlease ask Mr. Daniel Okafor at Meridian Outfitters Inc. or PT Sinar Laut.\n\nBest regards,\nMara Voss\n');
    expect(hits).toContain('PERSON:Tomas');
    expect(hits).toContain('PERSON:Daniel Okafor');
    expect(hits).toContain('ORG:Meridian Outfitters Inc');
    expect(hits).toContain('ORG:PT Sinar Laut');
    expect(hits).toContain('PERSON:Mara Voss');
  });

  it('recognises organizations by kind but not generic phrases', () => {
    const hits = find('Our details: First Cascade Bank and Northgate Auto Finance. The Bank will confirm.');
    expect(hits).toContain('ORG:First Cascade Bank');
    expect(hits).toContain('ORG:Northgate Auto Finance');
    expect(hits).not.toContain('ORG:The Bank');
  });

  it('ignores generic greetings and labelled references need a digit', () => {
    const hits = find('Dear Team,\nSee invoice no. INV-20931 and the contract terms.');
    expect(hits).toEqual(['ID:INV-20931']);
  });

  it('finds a reference even when two label words are chained', () => {
    expect(find('Payments reference contract no. MO-2026-0417 only.')).toEqual(['ID:MO-2026-0417']);
    expect(find('Account holder: Jonah Whitfield')).toEqual(['PERSON:Jonah Whitfield']);
  });
});

describe('vault and masking', () => {
  const text = 'Priya Raman signed for Harbor & Finch Studio Ltd. Later, Priya emailed priya@harbor.example about $7,400.';
  const ai: Detection[] = [{ text: 'Priya Raman', type: 'PERSON', source: 'on_device' }];
  const vault = addDetections(addDetections(emptyVault(), detectPatterns(text)), ai);

  it('gives the same value the same placeholder, including bare first names', () => {
    const masked = maskText(text, vault);
    expect(masked).toBe('[PERSON_1] signed for [ORG_1]. Later, [PERSON_1] emailed [EMAIL_1] about [MONEY_1].');
  });

  it('leaves no protected value in the masked payload', () => {
    expect(findLeaks(maskText(text, vault), vault)).toEqual([]);
    expect(findLeaks(text, vault).length).toBeGreaterThan(0);
  });

  it('restores real values in a model answer, with or without brackets', () => {
    const answer = '[PERSON_1] should invoice [MONEY_1]; ORG_1 keeps the IP. [PERSON_9] is unknown.';
    expect(rehydrateToString(answer, vault)).toBe(
      'Priya Raman should invoice $7,400; Harbor & Finch Studio Ltd keeps the IP. [PERSON_9] is unknown.',
    );
    expect(rehydrate(answer, vault).filter((s) => s.entity).length).toBe(3);
  });

  it('keeps placeholders stable when more detections arrive later', () => {
    const later = addDetections(vault, [
      { text: 'Daniel Okafor', type: 'PERSON', source: 'on_device' },
      { text: 'priya raman', type: 'PERSON', source: 'on_device' },
      { text: 'Contractor', type: 'ORG', source: 'on_device' },
    ]);
    expect(later.entities.find((e) => e.value === 'Priya Raman')?.id).toBe('PERSON_1');
    expect(later.entities.find((e) => e.value === 'Daniel Okafor')?.id).toBe('PERSON_2');
    expect(later.entities.some((e) => e.value === 'Contractor')).toBe(false);
    expect(later.entities.filter((e) => e.type === 'PERSON').length).toBe(2);
  });

  it('lets the user allow a value or a whole type through', () => {
    const money = vault.entities.find((e) => e.type === 'MONEY')!;
    expect(maskText(text, setEntityEnabled(vault, money.id, false))).toContain('$7,400');
    const noPeople = setTypeEnabled(vault, 'PERSON', false);
    expect(maskText(text, noPeople)).toContain('Priya Raman signed');
    const stats = shieldStats(segment(text, noPeople));
    expect(stats.allowedValues).toBe(1);
    expect(stats.protectedValues).toBe(3);
  });

  it('prefers the longest match when values overlap', () => {
    const v = addDetections(emptyVault(), [
      { text: 'Linden', type: 'ORG', source: 'manual' },
      { text: 'Linden Analytics LLC', type: 'ORG', source: 'manual' },
    ]);
    expect(maskText('Linden Analytics LLC and Linden.', v)).toBe('[ORG_2] and [ORG_1].');
  });

  it('merges what the model finds into what the patterns already protect', () => {
    // Seen with Gemini Nano on the sample contract: sentence punctuation copied into
    // names, and wider spans around values the pattern shield had already masked.
    const doc =
      'Between Meridian Outfitters Inc. and Priya Raman, trading as Harbor & Finch Studio Ltd. ' +
      'Meridian Outfitters pays to IBAN GB29 NWBK 6016 1331 9268 19. Signed for Harbor & Finch Studio Ltd';
    const base = addDetections(emptyVault(), detectPatterns(doc));
    const before = base.entities.length;
    const merged = addDetections(base, [
      { text: 'Meridian Outfitters Inc.', type: 'ORG', source: 'on_device' },
      { text: 'Harbor & Finch Studio Ltd.', type: 'ORG', source: 'on_device' },
      { text: 'IBAN GB29 NWBK 6016 1331 9268 19', type: 'ID', source: 'on_device' },
      { text: 'Meridian Outfitters', type: 'ORG', source: 'on_device' },
      { text: 'Priya Raman', type: 'PERSON', source: 'on_device' },
    ]);
    // Only the person is new; nothing got a second placeholder.
    expect(merged.entities.length).toBe(before + 1);
    expect(merged.entities.filter((e) => e.type === 'ORG').length).toBe(2);
    expect(merged.entities.some((e) => e.type === 'ID')).toBe(false);
    const masked = maskText(doc, merged);
    expect(masked).toBe(
      'Between [ORG_1]. and [PERSON_1], trading as [ORG_2]. [ORG_1] pays to IBAN [IBAN_1]. Signed for [ORG_2]',
    );
  });

  it('never drops the rest of a name when the model finds a fuller form', () => {
    // Regression: the greeting gave the patterns "Marcus"; the model then found
    // "Marcus Lindqvist". Treating that as already covered leaked the surname.
    const doc = 'To: Marcus Lindqvist\n\nHi Marcus,\nplease pay by Friday.\n\nRegards, Mr. Lindqvist';
    const base = addDetections(emptyVault(), detectPatterns(doc));
    const marcus = base.entities.find((e) => e.value === 'Marcus')!;
    expect(marcus).toBeDefined();
    const merged = addDetections(base, [
      { text: 'Marcus Lindqvist', type: 'PERSON', source: 'on_device' },
      { text: 'Mr. Marcus Lindqvist', type: 'PERSON', source: 'on_device' },
    ]);
    const masked = maskText(doc, merged);
    expect(masked).not.toMatch(/Marcus|Lindqvist/);
    // Same person, same placeholder as before the model ran.
    expect(merged.entities.filter((e) => e.type === 'PERSON').length).toBe(base.entities.filter((e) => e.type === 'PERSON').length);
    expect(merged.entities.find((e) => e.id === marcus.id)?.value).toBe('Marcus Lindqvist');
    expect(findLeaks(masked, merged)).toEqual([]);
  });
});

describe('sample documents', () => {
  for (const sample of SAMPLES) {
    it(`pattern shield alone hides every structured value in "${sample.label}"`, () => {
      const vault = addDetections(emptyVault(), detectPatterns(sample.text));
      const masked = maskText(sample.text, vault);
      expect(masked).not.toMatch(/@[\w-]+\.example/);
      expect(masked).not.toMatch(/\$\d/);
      expect(masked).not.toMatch(/555-01\d\d/);
      expect(masked).not.toMatch(/\d{8,}/);
      expect(findLeaks(masked, vault)).toEqual([]);
      expect(rehydrateToString(masked, vault).length).toBeGreaterThan(masked.length / 2);
    });
  }
});

describe('chunking', () => {
  it('keeps all text and respects the size limit', () => {
    const text = SAMPLES[0].text;
    const chunks = splitIntoChunks(text, 500);
    expect(chunks.join('')).toBe(text);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(500);
    expect(chunks.length).toBeGreaterThan(2);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('hard-cuts text that has no natural break', () => {
    const chunks = splitIntoChunks('x'.repeat(950), 400);
    expect(chunks.map((c) => c.length)).toEqual([400, 400, 150]);
  });
});

describe('routing policy', () => {
  const base: RouteInput = {
    weight: 'light',
    promptTokens: 900,
    device: 'available',
    online: true,
    strictLocal: false,
    onDeviceTokenBudget: 4000,
  };

  it('runs light tasks on-device first, with cloud fallback', () => {
    expect(decideRoute(base)).toMatchObject({ mode: 'prefer_on_device', expected: 'device' });
    expect(decideRoute({ ...base, device: 'unavailable' })).toMatchObject({ mode: 'prefer_on_device', expected: 'cloud' });
  });

  it('sends heavy tasks to the cloud, falling back to the device when it can', () => {
    expect(decideRoute({ ...base, weight: 'heavy' })).toMatchObject({ mode: 'prefer_in_cloud', expected: 'cloud' });
    expect(decideRoute({ ...base, weight: 'heavy', device: 'unavailable' }).mode).toBe('only_in_cloud');
    expect(decideRoute({ ...base, promptTokens: 9000 }).mode).toBe('only_in_cloud');
  });

  it('stays on the device when offline or strict local', () => {
    expect(decideRoute({ ...base, weight: 'heavy', online: false }).mode).toBe('only_on_device');
    expect(decideRoute({ ...base, weight: 'heavy', strictLocal: true }).mode).toBe('only_on_device');
  });

  it('blocks instead of silently using the cloud', () => {
    expect(decideRoute({ ...base, online: false, device: 'unavailable' }).mode).toBe('blocked');
    expect(decideRoute({ ...base, online: false, promptTokens: 9000 }).mode).toBe('blocked');
    expect(decideRoute({ ...base, strictLocal: true, device: 'downloadable' }).mode).toBe('blocked');
    expect(decideRoute({ ...base, strictLocal: true, promptTokens: 9000 }).mode).toBe('blocked');
  });
});
