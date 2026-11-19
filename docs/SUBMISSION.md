# Devpost submission kit

Everything the #BuildHybridAI submission form asks for. Replace the bracketed parts once the project is deployed.

## Required items

- [ ] Platform selected: **Web (Chrome)**
- [ ] Public GitHub repo with the MIT `LICENSE` detected in the About section
- [ ] Hosted URL (Firebase Hosting): https://blindfold-hybrid-ai.web.app (live once `npm run deploy` has run and a production App Check key is set)
- [ ] Demo video, 3 minutes or less, public on YouTube, in English: [link]
- [ ] Text description (below)
- [ ] App is free to use
- [ ] App Check enforced for Firebase AI Logic (debug tokens are accepted for judging)

## Project name

Blindfold

## Tagline

Ask AI about documents you can't show AI.

## Text description

### The problem

Freelancers, bookkeepers and small-business owners paste contracts, client emails and bank statements into AI chatbots every day, because the help is too useful to pass up. Each paste hands a third party the names, account numbers and amounts of people who never agreed to it. The usual advice, "don't paste sensitive data", ignores why people do it.

### What Blindfold does

Blindfold lets the cloud model do the work without seeing the values. On your device, it replaces every name, company, amount and account number with a placeholder such as [PERSON_1]. You review the blindfolded copy next to the original. Only the blindfolded copy can be sent. When the answer comes back, a vault that never leaves your browser restores the real values on screen.

Features:

- Two-pane "device boundary": your document on the left, exactly what the cloud sees on the right.
- Click a highlight to let a value through, select text to blindfold it by hand, toggle whole categories.
- Presets (summarize, action items, find risks, draft a reply) and free-form questions; real names typed into a question are blindfolded too.
- Every answer shows where it ran (on-device or cloud), which inference mode was requested, and the exact payload.
- A leak check scans each outgoing payload for protected values and blocks the request if it finds one.
- "Strict local" switch and offline support: if a request cannot run on-device, it is blocked with a reason rather than quietly sent to the cloud.
- Saved threads sync through Firestore as blindfolded text only. Open one on another device and you see placeholders, because the vault stayed behind.

### How we used Firebase AI Logic

Blindfold uses all four hybrid inference modes, each for a reason:

- ONLY_ON_DEVICE with a JSON response constraint: Gemini Nano finds names, organizations and places in the original text, which must not leave the device.
- PREFER_ON_DEVICE: light tasks run locally for free and fall back to the cloud with blindfolded text on devices without a model.
- PREFER_IN_CLOUD / ONLY_IN_CLOUD: heavy reasoning goes to Gemini in the cloud on blindfolded text; long prompts that exceed the on-device budget are cloud-only.
- ONLY_ON_DEVICE again when offline or when Strict local is on.

`response.inferenceSource` labels every answer. The routing policy is a pure, unit-tested function whose thresholds and model names come from Remote Config, so it can be tuned without a deploy. App Check (reCAPTCHA Enterprise, limited-use tokens) protects the Gemini API. Authentication gives each visitor an anonymous private space with an optional Google upgrade. Firestore, with owner-only and shape-validated rules, stores only blindfolded threads.

### Why hybrid matters here

The two models are not interchangeable in this app; they are composed. The on-device model is the only one trusted with the original, and it makes the cloud model safe to use. The cloud model provides the reasoning the small model cannot. On-device inference being free is also what makes it reasonable to scan every document a user opens in a free app.

### What's next

- A Chrome extension that blindfolds text before it is pasted into any chatbot.
- Android and iOS clients on the same Firebase AI Logic SDK, sharing blindfolded threads.
- Per-team masking policies delivered through Remote Config.

## Built with

firebase-ai-logic, gemini-nano, gemini, firebase-app-check, firebase-remote-config, firebase-authentication, cloud-firestore, firebase-hosting, react, typescript, vite

## Demo video script (about 2:50)

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 | Someone pasting a contract into a generic chatbot (blurred) | "We all do this. And every time, someone else's name, bank account and invoice go to a server they never agreed to." |
| 0:15 | Blindfold home | "Blindfold lets you ask AI about documents you can't show AI." |
| 0:25 | Click the freelance contract sample; panes appear | "On the left, my contract, on my device. On the right, the only copy that is allowed to leave. Names, companies, amounts and the IBAN are placeholders." |
| 0:45 | Point at the status line "Names found by Gemini Nano on this device" | "The names were found by Gemini Nano, running in Chrome through Firebase AI Logic in ONLY_ON_DEVICE mode. The original never left." |
| 1:00 | Click a highlight to let it through; select text and blindfold it | "I stay in control: let a value through, or blindfold anything by hand." |
| 1:10 | Click Summarize; answer tagged "Ran on this device" | "A light task runs on-device: free and private, nothing leaves the laptop. PREFER_ON_DEVICE." |
| 1:30 | Click Find risks; answer tagged "Ran in the cloud" | "Heavy reasoning goes to Gemini in the cloud. It reviewed the contract without learning a single name." |
| 1:50 | Flip "As the model wrote it"; open "Exact payload sent" | "This is what the model actually wrote, and this is exactly what it was sent. The real values were restored locally." |
| 2:10 | Turn Wi-Fi off; click Summarize; then Find risks is blocked | "Offline, light tasks still work. Heavy ones are blocked with a reason, never sent quietly." |
| 2:25 | Open the same app on a phone browser | "On a device with no local model, the same app falls back to patterns plus the cloud, and says so." |
| 2:40 | Ledger: "Protected values sent to the cloud: 0" | "One SDK, two models, and a boundary you can see. That's Blindfold." |

Recording notes: record in desktop Chrome with the on-device model downloaded; keep the header status pill visible; the DevTools Network tab is a strong proof shot for the offline segment.
