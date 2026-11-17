/** Prompts and task presets. Every prompt is a single string so the X-ray panel can show the exact payload. */

export interface TaskPreset {
  id: string;
  label: string;
  /** Light tasks try the on-device model first; heavy ones go to the cloud, blindfolded. */
  weight: 'light' | 'heavy';
  instruction: string;
}

export const TASKS: TaskPreset[] = [
  {
    id: 'summary',
    label: 'Summarize',
    weight: 'light',
    instruction: 'Summarize this document in 3 to 5 short bullet points. Keep the key parties, amounts and dates.',
  },
  {
    id: 'actions',
    label: 'Action items',
    weight: 'light',
    instruction: 'List the action items in this document as bullets: who needs to do what, and by when.',
  },
  {
    id: 'risks',
    label: 'Find risks',
    weight: 'heavy',
    instruction:
      'Review this document for risks, red flags and one-sided terms from the point of view of the person who received it. For each issue give: the clause or sentence, why it matters, and what to ask for instead. Order by severity.',
  },
  {
    id: 'reply',
    label: 'Draft a reply',
    weight: 'heavy',
    instruction:
      'Draft a clear, professional reply to this document on behalf of the person who received it. Be firm but polite, address the open points and propose concrete next steps.',
  },
];

export const DETECT_SYSTEM =
  'You extract sensitive named entities from text so they can be redacted. You only copy text that appears in the input. You never explain.';

export function detectPrompt(chunk: string): string {
  return `Find every sensitive named entity in the text below.

Types:
- PERSON: names of people
- ORG: companies, banks, employers, shops and other organizations
- LOCATION: street addresses, cities and specific places
- ID: reference, case, licence or document numbers

Rules:
- Copy each entity exactly as it is written in the text.
- Skip role words (Client, Contractor, Landlord), job titles, dates and amounts.
- Skip anything in square brackets such as [EMAIL_1]; it is already redacted.
- If there are none, return an empty list.

Text:
"""
${chunk}
"""`;
}

export const TRANSCRIBE_PROMPT =
  'Transcribe all text in this image exactly as written, keeping line breaks. Output only the transcribed text, with no commentary.';

export interface Exchange {
  question: string;
  answer: string;
}

/** Builds the one string that is sent to the model. `maskedDocument` and all exchanges must already be blindfolded. */
export function buildTaskPrompt(maskedDocument: string, instruction: string, history: Exchange[] = []): string {
  const earlier = history.length
    ? `\nEarlier in this conversation:\n${history
        .map((h) => `Request: ${h.question}\nYour answer: ${h.answer}`)
        .join('\n\n')}\n`
    : '';
  return `You are helping someone with a confidential document. Before the text reached you, sensitive values were replaced with placeholders such as [PERSON_1], [ORG_2] or [MONEY_3].

Rules:
- Refer to those values only by their placeholder, written exactly as given, brackets included.
- Never guess, invent or describe what a placeholder stands for. The same placeholder always means the same real value.
- You cannot do arithmetic on [MONEY_n] placeholders; refer to them by placeholder instead.
- Answer in plain text: short paragraphs and "- " bullets. No tables and no preamble.

<document>
${maskedDocument}
</document>
${earlier}
Request: ${instruction}`;
}
