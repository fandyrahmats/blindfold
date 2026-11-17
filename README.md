# Blindfold

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Ask AI about documents you can't show AI.**

Blindfold is a web app for people who handle other people's data: freelancers, bookkeepers, small-business owners. Paste a contract, a client email or a bank statement, and Blindfold swaps every name, company, amount and account number for a placeholder **on your device**. The cloud model only ever works on the blindfolded copy. When the answer comes back, the real values are restored locally from a vault that never leaves the browser.

It is built on **Firebase AI Logic hybrid inference**: Gemini Nano in Chrome does the private work on-device, Gemini in the cloud does the heavy reasoning, and the app shows you exactly which one ran and exactly what it was sent.

Built for the [#BuildHybridAI 2026 hackathon](https://firebasehybridaihackathon.devpost.com/) (platform: Web / Chrome).

## Why hybrid, and not just "on-device with a fallback"

Most hybrid apps treat the two models as interchangeable: try local, fall back to cloud. Blindfold composes them inside one request, because each is good at something the other cannot do:

| | On-device (Gemini Nano) | Cloud (Gemini) |
| --- | --- | --- |
| Sees the original document | Yes | **Never** |
| Job | Find names, companies, addresses; answer light tasks | Long documents, risk review, drafting |
| Cost per request | Free | Metered |
| Works offline | Yes | No |

The result is a privacy boundary you can see on screen: the left pane is your document, the right pane is the only copy that is allowed to leave.

## How it works

```mermaid
flowchart LR
  subgraph Device["On this device"]
    A[Original document] --> B[Pattern shield<br/>emails, phones, IBANs, cards, amounts]
    B --> C[Gemini Nano via Firebase AI Logic<br/>ONLY_ON_DEVICE: names, orgs, places]
    C --> D[(Local vault<br/>PERSON_1 = real value)]
    D --> E[Blindfolded copy]
    E --> F{Router}
    I[Restore real values] --> J[Answer on screen]
  end
  subgraph Cloud["Cloud"]
    G[Gemini via Firebase AI Logic]
    H[(Firestore<br/>blindfolded threads only)]
  end
  F -- light task: PREFER_ON_DEVICE --> I
  F -- heavy task: PREFER_IN_CLOUD / ONLY_IN_CLOUD --> G
  G -- answer with placeholders --> I
  E -.-> H
```

1. **Blindfold.** Deterministic patterns catch structured identifiers instantly. Then the on-device model finds what patterns cannot: free-form names, companies and addresses. Each value gets a stable placeholder such as `[PERSON_1]`.
2. **Review.** You see both versions side by side. Click a highlight to let a value through, select any text to blindfold it by hand, or toggle a whole category (for example, let amounts through so the model can add them up).
3. **Route.** Every request is routed by a small, unit-tested policy to one of the four Firebase AI Logic inference modes.
4. **Check.** Before anything is sent, a leak check scans the exact outgoing payload for every protected value. If one is found, the request is not sent.
5. **Restore.** The answer arrives with placeholders. The vault restores real values on screen, and you can flip any answer to "as the model wrote it" to see what the model actually knew.

## How Firebase AI Logic is used

All model calls are in [`src/lib/ai.ts`](src/lib/ai.ts) and go through `getGenerativeModel(ai, { mode, inCloudParams, onDeviceParams })` from `firebase/ai`.

| Step | Inference mode | Why |
| --- | --- | --- |
| Entity detection | `ONLY_ON_DEVICE` with a JSON `responseConstraint` | The original text must not leave the device. |
| Entity detection, device has no model | none by default; `ONLY_IN_CLOUD` with `responseSchema` if the user opts in | Honest fallback: patterns are masked first, and the user is told names will be visible for that one step. |
| Light tasks (summarize, action items) | `PREFER_ON_DEVICE` | Free and private when possible; the SDK falls back to the cloud with the blindfolded text. |
| Heavy tasks (risk review, drafting, questions) | `PREFER_IN_CLOUD`, or `ONLY_IN_CLOUD` when the prompt exceeds the on-device budget | Better reasoning; falls back to the device if the cloud is unreachable. |
| Offline, or "Strict local" switch | `ONLY_ON_DEVICE` | Never silently use the cloud. If it cannot run locally, the request is blocked with a reason. |
| Screenshot to text | `ONLY_ON_DEVICE` multimodal; `ONLY_IN_CLOUD` only after a confirmation | Image input stays local when a model is available. |

Every answer is labelled from `response.inferenceSource` (`ON_DEVICE` or `IN_CLOUD`), together with the mode that was requested and the exact payload. The routing policy is a pure function in [`src/lib/router.ts`](src/lib/router.ts).

Other Firebase products:

- **App Check** (required by AI Logic): reCAPTCHA Enterprise in production, debug provider in development, limited-use tokens for replay protection. See [`src/lib/firebase.ts`](src/lib/firebase.ts).
- **Remote Config**: cloud model names, the on-device token budget, detection chunk size and whether cloud-assisted detection may be offered. The routing policy can be tuned without a deploy. Template: [`remoteconfig.template.json`](remoteconfig.template.json).
- **Authentication**: anonymous by default, optional upgrade to Google so threads follow you across devices.
- **Cloud Firestore**: stores **only** the blindfolded document and blindfolded answers, with offline persistence. Rules in [`firestore.rules`](firestore.rules) restrict each thread to its owner and validate its shape. Open a thread on another device and you get the placeholders, not the values, because the vault stayed where it was created.
- **Hosting**: static deploy with an offline shell (service worker), so the on-device path keeps working with no connection.

## Run it

Requirements: Node.js 20+, a Firebase project, desktop Chrome.

```bash
npm install
cp .env.example .env.local   # then fill in your Firebase web app config
npm run dev                  # http://localhost:5173
```

Without a Firebase config the app still opens in "pattern shield only" mode, so you can inspect the boundary and the outgoing payloads before connecting anything.

### Firebase setup

```bash
npx -y firebase-tools@latest login
npx -y firebase-tools@latest use --add          # pick your project
npx -y firebase-tools@latest init ailogic       # enables the Gemini Developer API for AI Logic
npx -y firebase-tools@latest deploy --only firestore:rules,remoteconfig
```

Then, in the Firebase console:

1. **Project settings > Your apps**: register a Web app and copy its config into `.env.local`.
2. **Authentication > Sign-in method**: enable Anonymous and Google.
3. **Firestore Database**: create the database (production mode; the rules above are deployed by the command).
4. **Security > App Check**: confirm enforcement is on for Firebase AI Logic.
   - Development: start the app, copy the debug token printed in the browser console, and register it under **Apps > Manage debug tokens**. To keep it stable, put it in `VITE_APPCHECK_DEBUG_TOKEN` in `.env.local` (never commit it).
   - Production: register the app with reCAPTCHA Enterprise and set `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.

### On-device model in Chrome

- Desktop Chrome 139 or newer on Windows, macOS, Linux or Chromebook Plus.
- Hardware: more than 4 GB of VRAM, **or** 16 GB of RAM with 4+ CPU cores; 22 GB of free disk space on the profile volume.
- For screenshot reading, enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and restart.
- Click **Enable on-device AI** in the header to download the model once. Check its state at `chrome://on-device-internals`.
- On-device input and output is English (Chrome also supports Spanish, Japanese, German and French).

On any other browser or device, Blindfold runs in fallback mode: pattern shield plus the cloud model on blindfolded text.

### Test, build, deploy

```bash
npm test          # 26 unit tests: detectors, vault, leak check, routing, rendering
npm run build
npm run deploy    # build + firebase deploy (hosting, rules, Remote Config)
```

## Project layout

```
src/lib/detectors.ts     Pattern shield (regex + validation, e.g. Luhn for cards)
src/lib/pseudonymize.ts  Vault, masking, restoring, leak check
src/lib/router.ts        Routing policy -> Firebase AI Logic inference mode
src/lib/ai.ts            All Firebase AI Logic calls (hybrid inference)
src/lib/firebase.ts      App, App Check, Auth, Firestore, Remote Config
src/lib/store.ts         Local vault storage vs. Firestore (blindfolded only)
src/lib/prompts.ts       Task presets and the single-string prompts
src/components/          Header, intake, two-pane workspace, conversation
firestore.rules          Owner-only, shape-validated threads
remoteconfig.template.json
```

## Limits worth knowing

- Detection is not perfect. Patterns are precise but narrow; the on-device model is broader but can miss a name. That is why the blindfolded copy is always shown before you ask, and why you can blindfold any selection by hand.
- A blindfolded amount cannot be added up by the cloud model. Let the Amounts category through when you need arithmetic.
- The context of a document can identify someone even without their name. Blindfold reduces what the cloud can see; it does not make a document anonymous.
- On devices without a local model, names are protected only by patterns unless the user opts in to cloud-assisted detection.

## Built with

Firebase AI Logic (hybrid inference), Gemini Nano in Chrome, Gemini Developer API, Firebase App Check, Remote Config, Authentication, Cloud Firestore, Firebase Hosting, React, TypeScript, Vite, Vitest. Developed with Claude Code using the [Firebase agent skills](https://firebase.google.com/docs/ai-assistance/agent-skills) (pinned in `skills-lock.json`; restore them with `npx skills experimental_install`) and the Firebase MCP server (`.mcp.json`).

## License

[MIT](LICENSE)
