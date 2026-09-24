# Care Desk

Care Desk is a patient-support copilot for a telehealth team that serves patients in Australia, New Zealand and the UK. It reads each incoming message, removes personal details, runs fixed safety rules, and drafts a reply to routine questions from the patient's own records and the written support policy. A person reads every draft and decides what is sent. Anything clinical, a crisis or a report of a death never gets an AI reply: it goes straight to a clinician, and that patient's orders are put on hold.

**See it live:** [caredesk.autopilotyourworkflow.com](https://caredesk.autopilotyourworkflow.com). Every patient, order and message in it is fictional.

## The problem

A patient-support team spends most of its day on routine questions: where is my order, why did my price change, can I move my appointment. Each answer means looking up the order, the charge and the policy, then writing it out carefully. Mixed in with those are the messages that matter most: a side effect, a question about a dose, someone in distress, a family member reporting that a patient has died. Those must never be answered from a template, and they must never wait at the back of a queue.

Care Desk takes the lookup and the first draft off the agent for routine messages, and makes sure the serious ones are caught, raised and held before anyone could reply to them by mistake.

## How a message flows

Every message passes through the same seven checks, shown to the agent as a trail beside the message:

1. **Personal details removed.** Names, emails, phone numbers, addresses, dates of birth, health ids and card numbers are replaced with placeholders before any AI sees the text.
2. **Safety rules checked.** Fixed rules, not AI, look for clinical questions, side effects, adverse events, crisis language and reports of a death, in the original wording. A hit stops the trail here.
3. **Sorted by type.** Claude sorts the redacted message (order status, billing, plan change and so on). If it sees something clinical or urgent, the trail stops. If it is unsure, the message goes to a person.
4. **Sources found.** The patient's orders, charges and appointments, plus the most relevant sections of the support policy.
5. **Reply drafted.** Claude drafts a reply, but only when the rules and the sorter both agree the message is routine. Every fact in the draft is numbered back to the record or policy section it came from.
6. **Facts checked.** A plain code check, not AI, confirms that every date, amount, order number and tracking number in the draft appears in those sources.
7. **A person decides.** The agent sends, edits or escalates. Nothing is ever sent automatically.

## Safety design

- **Rules before the model.** The safety rules run first, on the original text, and do not depend on the AI. The model only drafts a message that the rules have already passed.
- **What never gets an AI reply.** Clinical questions, side effects, adverse events, crisis language and reports of a death go to a clinician with no draft. Requests to speak to a person, complaints and privacy requests go to a person with no draft.
- **Order holds.** Crisis language, an adverse event or a reported death puts that patient's orders on hold. A patient who asks to stop deliveries gets a hold too. If a patient raises something serious in one message, drafts on their other open messages are held for a clinician first; if a death is reported, every draft to that patient is withdrawn.
- **Personal details removed.** The AI works on redacted text. The desk fills in the patient's first name and the agent's name after the draft comes back, so the AI never sees either.
- **The fact check.** A draft that mentions a date, amount or number not found in the sources, or that contains dosing figures, medical advice or promotional wording, is blocked. The agent can still see it, but cannot send it as it stands.
- **Over-escalation on purpose.** Either layer can raise a message to a clinician; only both together can allow a draft. The sorter can raise a rule's decision to urgent but can never lower it. When the AI is unavailable, a backup word check runs before the message goes to a person. Sending a routine message to a clinician costs a few minutes. Missing a serious one is not acceptable.

## How it is tested

- **A labelled test set** (`data/testset.json`) gives the expected type, route and hold for every demo message, including deliberately tricky ones.
- **Red-team cases** sit in a separate slice that never appears in the queue: messages written to slip past the rules, such as a euphemism for wanting to die that uses none of the usual crisis words.
- **The release gate** (`npm run eval`) scores every result against the labels and fails if any safety case was not sent to a clinician, any urgent case lost its priority, any required hold was missed, or a draft could be sent to a patient whose death was reported.
- **Unit tests** (`npm test`) cover the rules, redaction, the fact check, the queue and the Worker's limits.

The figures on the site come from one full run with Claude over all 303 labelled test messages: Claude Haiku 4.5 sorted every message the safety rules had not already stopped, and Claude Opus 5.5 wrote the draft replies. Two small prompt fixes followed, both changing only how a reply treats the patient's other recent messages, so the 60 messages whose drafts saw such a message were run again after each. See the [Test results page](https://caredesk.autopilotyourworkflow.com/tests/) for what the results measured.

## Architecture

- **The site** is a Next.js and TypeScript app built as a static export. The demo queue is precomputed, so browsing it makes no AI calls.
- **One Cloudflare Worker** serves those static files and handles the live "Try it" box at `/api/try`. It runs the same pipeline on the typed message, calls the Claude API with a key stored as a Worker secret, and streams the trail back step by step.
- **Workers KV** holds the limits: a daily spend cap and a number of tries per visitor per hour, with hard ceilings so a typo cannot switch them off. It also holds an on and off switch that takes effect without a redeploy.
- **The no-AI fallback.** When the daily budget is used up, the box is switched off or the AI is unreachable, the page still runs the real safety rules in the visitor's browser, with a clearly labelled simple built-in stand-in for Claude doing the sorting and drafting.

The same pipeline code runs in Node, in the browser and in the Worker.

## Privacy

Nothing typed into the live box is stored or logged. The Worker keeps only counters and amounts, keyed by a salted hash of the visitor's connection that changes every hour, so a visitor cannot be followed over time. There is no patient database: every patient is fictional, and each visitor's choices on the desk stay in their own browser.

## Run it locally

You need Node.js.

```sh
npm ci
npm run dev                    # the site at http://localhost:3000
npm test                       # unit tests
npm run eval -- --allow-mock   # score a local sample run (marked as a sample, not for publishing)
```

To run the live box with the Worker:

```sh
cp .dev.vars.example .dev.vars # MOCK=1 uses the simple built-in stand-in for Claude, so no API key is needed
npm run build                  # the Worker serves the static export in ./out
npx wrangler dev
```

Day-to-day operation (limits, keys, re-running the evaluation) is covered in [docs/RUNBOOK.md](docs/RUNBOOK.md). The one-page guide for agents working the queue is [docs/AGENT-GUIDE.md](docs/AGENT-GUIDE.md).

## About this project

Care Desk is an unofficial concept built on fictional data. It is not affiliated with, endorsed by or connected to any company. No real patient, order or message appears anywhere in it, and it connects to no real pharmacy, payment or helpdesk system.

Built by Chanon Poovaviranon (Beam)
