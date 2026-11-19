import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { detectPatterns } from '../lib/detectors';
import { buildTaskPrompt } from '../lib/prompts';
import { addDetections, emptyVault, findLeaks, maskSegments, maskText, rehydrate, shieldStats } from '../lib/pseudonymize';
import { SAMPLES } from '../lib/samples';
import { Rich } from './Rich';
import { Workspace } from './Workspace';

const text = 'Dear Tomas,\nLinden Analytics LLC is owed $4,740 on invoice no. INV-20931.';
const vault = addDetections(emptyVault(), detectPatterns(text));
const answer = `## Summary
- **[ORG_1]** is owed [MONEY_1].
- Ask [PERSON_1] for a payment date.

Reference: [ID_1]`;

describe('answer rendering', () => {
  it('restores real values locally', () => {
    const html = renderToStaticMarkup(<Rich text={answer} vault={vault} real />);
    expect(html).toContain('<h4>Summary</h4>');
    expect(html).toContain('<strong><span class="restored"');
    expect(html).toContain('>Linden Analytics LLC</span>');
    expect(html).toContain('>$4,740</span>');
    expect(html).toContain('>Tomas</span>');
    expect(html).toContain('>INV-20931</span>');
    expect(html).not.toContain('[ORG_1]');
    expect(html.match(/<li>/g)?.length).toBe(2);
  });

  it('can show exactly what the model wrote, as redaction bars', () => {
    const html = renderToStaticMarkup(<Rich text={answer} vault={vault} real={false} />);
    expect(html).toContain('>ORG 1</span>');
    expect(html).toContain('>MONEY 1</span>');
    expect(html).not.toContain('Linden Analytics');
    expect(html).not.toContain('$4,740');
  });
});

describe('outgoing payload', () => {
  it('never contains a protected value, including ones typed into the question', () => {
    for (const sample of SAMPLES) {
      const v = addDetections(emptyVault(), detectPatterns(sample.text));
      const first = v.entities[0];
      const question = maskText(`What should I say about ${first.value}?`, v);
      const prompt = buildTaskPrompt(maskText(sample.text, v), question, [
        { question: 'Summarize', answer: `[${first.id}] is involved.` },
      ]);
      expect(findLeaks(prompt, v)).toEqual([]);
      expect(prompt).toContain(`[${first.id}]`);
    }
  });
});

describe('threads opened without the vault (another device)', () => {
  const maskedDoc = 'Hi [PERSON_1],\nInvoice [ID_1] for [MONEY_1] is overdue. [PERSON_1] must pay.';

  it('keeps placeholders as bars because the real values are not here', () => {
    const html = renderToStaticMarkup(<Rich text="Ask [PERSON_1] about [MONEY_1]." vault={emptyVault()} real />);
    expect(html).toContain('>PERSON 1</span>');
    expect(html).toContain('>MONEY 1</span>');
    expect(html).not.toContain('class="restored"');
  });

  it('shows the blindfolded copy with bars and correct counts', () => {
    const segments = rehydrate(maskedDoc, emptyVault(), true);
    expect(maskSegments(segments)).toBe(maskedDoc);
    const stats = shieldStats(segments);
    expect(stats.protectedValues).toBe(3);
    expect(stats.protectedOccurrences).toBe(4);
    const html = renderToStaticMarkup(
      <Workspace
        segments={segments}
        stats={stats}
        scan={{ state: 'idle' }}
        foreign
        canRescan={false}
        onRescan={() => {}}
        onToggleEntity={() => {}}
        onToggleType={() => {}}
        onMaskSelection={() => {}}
      />,
    );
    expect(html).toContain('created on another device');
    expect(html.match(/class="bar"/g)?.length).toBe(4);
    expect(html).toContain('<strong>3</strong>');
  });
});
