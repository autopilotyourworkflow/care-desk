---
name: Care Desk
description: A safety-first patient-support copilot where every message shows its own check trail, ending at a person's decision.
colors:
  navy-900: "#010337"
  navy-950: "#060a20"
  navy-app: "#0a182a"
  navy-800: "#0e1250"
  navy-700: "#1c2168"
  navy-600: "#2e3482"
  navy-500: "#474e9c"
  navy-400: "#6c73b8"
  navy-300: "#9fa5d6"
  navy-200: "#c9cdeb"
  navy-100: "#e4e6f6"
  navy-50: "#f2f3fb"
  canvas: "#f8f5f0"
  surface: "#ffffff"
  panel: "#f1ece4"
  inset: "#f7f8fb"
  field: "#eff3f9"
  field-hover: "#e6ecf5"
  ink: "#25292e"
  heading: "#010337"
  muted: "#5f6776"
  muted-icon: "#6f7887"
  on-navy: "#ffffff"
  on-navy-muted: "#b8c0ee"
  line: "#e6e1d8"
  line-cool: "#e4e8ef"
  line-strong: "#cfd5df"
  control-line: "#7d8596"
  focus: "#2f6fd6"
  focus-on-navy: "#8fb4ff"
  success-bg: "#d7f2e0"
  success-fg: "#05693f"
  success-icon: "#078e55"
  info-bg: "#dcefff"
  info-fg: "#1b6893"
  clinician-bg: "#e0e4fc"
  clinician-fg: "#3a47b8"
  clinician-accent: "#6b7cff"
  urgent-bg: "#ffdede"
  urgent-fg: "#9e1119"
  urgent-solid: "#b3131f"
  hold-bg: "#fdecd0"
  hold-fg: "#7d4400"
  hold-icon: "#a65800"
  warning-bg: "#fff3c4"
  warning-fg: "#7a5a00"
  error-bg: "#fff0f0"
  error-fg: "#b42318"
  disabled-bg: "#eceae6"
  disabled-fg: "#8b919b"
  selected-bg: "#eceefa"
typography:
  display-hero:
    fontFamily: "Clash Display, Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 500
    lineHeight: "1.08"
    letterSpacing: "-0.005em"
  display-hero-sm:
    fontFamily: "Clash Display, Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3.25rem"
    fontWeight: 500
    lineHeight: "1.08"
    letterSpacing: "-0.005em"
  display-hero-lg:
    fontFamily: "Clash Display, Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 500
    lineHeight: "1.06"
    letterSpacing: "-0.005em"
  display-hero-xl:
    fontFamily: "Clash Display, Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3.625rem"
    fontWeight: 500
    lineHeight: "1.04"
    letterSpacing: "-0.005em"
  display-page:
    fontFamily: "Clash Display, Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 500
    lineHeight: "2.25rem"
    letterSpacing: "-0.005em"
  wordmark:
    fontFamily: "Clash Display, Poppins, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.4375rem"
    fontWeight: 500
    lineHeight: "2rem"
    letterSpacing: "-0.005em"
  title:
    fontFamily: "Poppins, ui-sans-serif, system-ui, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
  body-lg:
    fontFamily: "Poppins, ui-sans-serif, system-ui, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  body:
    fontFamily: "Poppins, ui-sans-serif, system-ui, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.375rem"
  label:
    fontFamily: "Poppins, ui-sans-serif, system-ui, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1.125rem"
  micro:
    fontFamily: "Poppins, ui-sans-serif, system-ui, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: "1rem"
  code:
    fontFamily: "ui-monospace, Cascadia Mono, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: "1rem"
rounded:
  card: "24px"
  control: "16px"
  inner: "12px"
  token: "6px"
  pill: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
  topbar: "64px"
components:
  button-primary:
    backgroundColor: "{colors.navy-900}"
    textColor: "{colors.on-navy}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.navy-700}"
  button-primary-active:
    backgroundColor: "{colors.navy-950}"
  button-primary-disabled:
    backgroundColor: "{colors.disabled-bg}"
    textColor: "{colors.disabled-fg}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.heading}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.field}"
  button-subtle:
    backgroundColor: "{colors.field}"
    textColor: "{colors.heading}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-subtle-hover:
    backgroundColor: "{colors.field-hover}"
  button-destructive:
    backgroundColor: "{colors.urgent-solid}"
    textColor: "{colors.on-navy}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-destructive-hover:
    backgroundColor: "{colors.urgent-fg}"
  button-on-navy:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.navy-900}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-on-navy-hover:
    backgroundColor: "{colors.navy-50}"
  button-sm:
    typography: "{typography.label}"
    rounded: "{rounded.inner}"
    padding: "0 12px"
    height: "32px"
  button-lg:
    typography: "{typography.body-lg}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "48px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "24px"
  inset:
    backgroundColor: "{colors.inset}"
    rounded: "{rounded.inner}"
    padding: "12px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  input-hover:
    backgroundColor: "{colors.field-hover}"
  input-focus:
    backgroundColor: "{colors.surface}"
  input-error:
    backgroundColor: "{colors.error-bg}"
    textColor: "{colors.ink}"
  chip-neutral:
    backgroundColor: "{colors.field}"
    textColor: "{colors.heading}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "24px"
  chip-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success-fg}"
    rounded: "{rounded.pill}"
    height: "24px"
  chip-info:
    backgroundColor: "{colors.info-bg}"
    textColor: "{colors.info-fg}"
    rounded: "{rounded.pill}"
    height: "24px"
  chip-clinician:
    backgroundColor: "{colors.clinician-bg}"
    textColor: "{colors.clinician-fg}"
    rounded: "{rounded.pill}"
    height: "24px"
  chip-urgent:
    backgroundColor: "{colors.urgent-bg}"
    textColor: "{colors.urgent-fg}"
    rounded: "{rounded.pill}"
    height: "24px"
  chip-hold:
    backgroundColor: "{colors.hold-bg}"
    textColor: "{colors.hold-fg}"
    rounded: "{rounded.pill}"
    height: "24px"
  chip-sample:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning-fg}"
    rounded: "{rounded.pill}"
    height: "24px"
  filter-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.heading}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "32px"
  filter-pill-selected:
    backgroundColor: "{colors.navy-900}"
    textColor: "{colors.on-navy}"
  segmented-control:
    backgroundColor: "{colors.field}"
    rounded: "{rounded.control}"
    padding: "4px"
  segmented-control-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.heading}"
    rounded: "{rounded.inner}"
  nav-link:
    textColor: "{colors.muted}"
    typography: "{typography.body}"
    rounded: "{rounded.inner}"
    padding: "0 12px"
    height: "36px"
  nav-link-active:
    backgroundColor: "{colors.field}"
    textColor: "{colors.heading}"
  notice:
    backgroundColor: "{colors.info-bg}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "14px"
  toast:
    backgroundColor: "{colors.navy-900}"
    textColor: "{colors.on-navy}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 8px 10px 16px"
  tooltip:
    backgroundColor: "{colors.navy-900}"
    textColor: "{colors.on-navy}"
    typography: "{typography.label}"
    rounded: "{rounded.inner}"
    padding: "6px 10px"
  trail-step-icon:
    rounded: "{rounded.pill}"
    size: "28px"
  trail-stop-tag:
    backgroundColor: "{colors.clinician-fg}"
    textColor: "{colors.on-navy}"
    typography: "{typography.micro}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
    height: "20px"
  trail-stop-tag-urgent:
    backgroundColor: "{colors.urgent-solid}"
    textColor: "{colors.on-navy}"
  trail-stop-box:
    backgroundColor: "{colors.clinician-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.inner}"
    padding: "12px"
  trail-stop-box-urgent:
    backgroundColor: "{colors.urgent-bg}"
    textColor: "{colors.ink}"
---

# Design System: Care Desk

This file describes the design system as it exists in the code today. The normative sources are
`app/globals.css` (every token), `components/ui` (primitives), `components/trail` (the check trail) and
`components/shell` (the frame). When this file and the code disagree, the code wins and this file is stale: fix it.
A live reference of every primitive and state sits at `/dev/components` (`app/dev/components/KitchenSink.tsx`).

## Overview

**Creative North Star: "The Desk That Shows Its Working"**

Care Desk is a patient-support desk for a telehealth business, built on fictional data and shown in the look and
feel of that business: brand navy on a warm off-white canvas, white 24px cards, 16px controls on a pale blue grey
fill, pill tags in soft tints. The one idea the whole interface serves is that every message carries its own
**check trail**, a vertical list of what happened to it, step by step, ending at a person's decision. Safety is not
explained on an About page; it is visible on every ticket.

The world is calm, warm and orderly rather than clinical or techy. Density is moderate on the working screens and
generous on the evaluator screens. Colour is restrained: navy carries identity and the one main action; the tints
carry state and nothing else. The loudest thing the system ever draws is a safety stop, and it is loud on purpose.

The first visitor may be a non-technical reader with two to five minutes, possibly on a phone. Every surface is
built so the answer to "what happened here?" is readable in a few seconds in plain words, with the expert detail
(what the AI saw, the rules that matched, the sources, the fact check) one click away inside the same trail.

**Key Characteristics:**
- Navy (`navy-900`) on warm canvas; white cards; the pale blue grey `field` for every control.
- Two type voices only: Clash Display for page titles and the wordmark, Poppins for everything else.
- Soft, navy-tinted, offset shadows; never hard or coloured halos.
- State is always icon plus words plus tint, never colour alone.
- One authored motion moment: the trail ticking in sequence and halting at a stop.
- Fictional data is labelled wherever it could be mistaken for real; the sample note appears once per page, not on
  every card.
- Warm photos of the people (patient, support agent, clinician) and a soft eucalyptus texture on the story pages;
  the product itself is the proof beside them. No photos inside the work tools (see Imagery).
- Answer first, detail on demand: each page opens with its answer in a screen or less, and the expert detail is
  folded one click away, never deleted.

### Surfaces and their mode

| Surface | Route | Mode | Purpose |
|---|---|---|---|
| Welcome | `/` | Brand, the decision page | The hero on the full navy field: the wordmark and Concept pill, the promise, one short line, **Start the 1-minute tour** and **Open the desk**, and the concept line, set straight on navy (no card). Beside it the support agent photo in a tall 24px frame, with the live mini trail floating over its lower left edge as a white card, running two example messages (one ticks through to a checked draft, one stops at the safety rules). Below: "How a message moves" in three steps (patient photo, the seven checks, clinician photo), "What keeps it safe" on the eucalyptus band, "Talk to me" (the builder, first person, with the 90-day plan) and "Explore the demo" (three doors plus quiet text links). |
| Tour | overlay on real screens | Guided | Five stops, one idea each: the checked reply, the check trail beside it (its seven steps laid out), a message the safety rules stopped (all three on the desk), the Test results headline and the Try box; then the closing card. Each card has five dots and "1 of 5", a title of a few words and one or two sentences, Skip, Back and Next; the arrow keys and Esc work without a printed hint. The card sits beside what it points at, which is lit with a white ring while the rest of the page dims to 40 percent navy. It points at the product; it never replaces it. The closing card is the builder's thanks in the first person, with his headshot, "Email me" as its one primary action, LinkedIn and the written-out address; Finish steps down to secondary there. |
| Desk | `/desk/` | Operate, full height | Three steps, one new thing at a time. First the queue alone: nothing opens on its own, and the empty area says "Your next message opens here" with one button that opens the first checked draft. Then the conversation: the patient's message with the reply straight under it (the checked draft, its sources folded to one line, and Send, Edit, Escalate; Pass to a person sits in the reply's More actions menu). Then, on **Show details** beside the message title, the details: the check trail folded to one line of seven ticks and the patient card (plan and order open, the rest under "More about"), under a "Details" header with a close button. The details stay open from message to message once asked for. Queue rows carry one status chip (a safety row adds its reason and the hold). Keyboard first. The subtitle doubles as the first-visit hint ("Pick a message. Green means a checked draft is ready; anything clinical is already with a clinician."). No photos. |
| Clinician queue | `/clinician/` | Operate, full height | The same three steps: the list alone (the empty area offers the first clear urgent case), then the escalation, then on **Show details** the order hold and the patient card (the number to call also sits by the call buttons). Escalations with the reason, then the message with the triggering words highlighted and one line naming what each word is ("What the AI thought" and the full trail are folded), the order hold, a clinician reply box (no AI; the activity log shows once there is something in it) and a crisis support card. The patient card keeps the place, local time, phone and any replies held back; the rest folds under "More about". No photos. |
| Insights | `/insights/` | Operate, report | Team lead view. First tier: the first-response chart and "Your numbers" side by side, then Safety and "Where messages went" (By route, By type, Table). "Your numbers" shows the weekly messages and the cost of an hour; the three timings fold under "More assumptions". "How the estimate works" and "How the saving is worked out" are folded. A second tier under "For the team lead" sits on flatter panels with no shadow: What to automate next (top three, the rest folded), AI cost, How drafts were used. One "Sample results" notice in the header; simulated and estimate labels stay in the chart legend and descriptions. Must read on a phone. |
| Test results | `/tests/` | Operate, report | The first screen answers "is it safe, and how was it tested": the verdict card (pass chip, the safety headline, two short facts on holds and surprise messages, the routing figure, with one plain caveat only when the results come from the stand-in) beside a "How it was tested" panel on the deep eucalyptus photo. Folded: "More detail on these results", "What the check looks for", and in the closing "About the test set" card, "How this is tested" and "What changed between versions". Sorting by type and Fact check stay open. Three tricky cases show before "Show all"; the case table starts at 8 rows with Show more, Show all, search and filters (the key to its result labels folds under "What the results mean"), and a deep link or tricky-case click still expands it. Must read on a phone. |
| Try it | `/try/` | Operate, live | Type a message, pick a sample patient, watch the trail stream step by step. Before the first run the Live trail panel shows the chosen patient's initials avatar, "Write as {name} and press Run the checks" and the seven checks waiting quietly. The privacy note and the limits note are one sentence each. |
| How it works | `/how-it-works/` | Read | "In short" first (a lead line, two short paragraphs, three principles, the light eucalyptus photo beside the text), then the diagram, the live redaction example, "Where a person decides" as two photo cards (agent, clinician) and the failure table. The reference parts (Where data lives, Agent guide, Runbook, Stack) fold under "For the team running it"; the on-this-page rail lists them indented, and a link or hash to any of them opens its fold. Prose measure 62 to 70ch. |
| Not found | any | Read | A page title in Clash Display and a way back. |

Operate surfaces follow earned familiarity: standard navigation, standard controls, the same component vocabulary
everywhere. Brand energy is spent only on the welcome field, the photos on the story pages and the trail itself.

### The direction contract

`app/layout.tsx` emits a short direction contract as an HTML comment, the first element inside `<body>`, so a
review can audit the render against it. It must stay under 150 words, contain no double hyphen, and carry the seed
key `e613dc99`; after `npm run build`, `grep -c e613dc99 out/index.html` must return 1. Change it only when the
direction itself changes, and then update this file too.

## Colors

A warm, quiet palette: one deep brand navy and its scale, warm off-white paper, a cool blue grey for controls, and a
family of soft tints that each mean exactly one state.

### Primary
- **Midnight Brand Navy** (`navy-900`): headings, primary buttons, the selected filter pill, the selected tab
  underline, tooltips and toasts, the welcome field, the wordmark, the "awaiting a person" trail icon. It is the
  identity colour and the colour of the one main action in a region.
- **Navy scale** (`navy-50` to `navy-800`): hover and pressed steps (`navy-700` hover, `navy-950` pressed on primary
  buttons; `navy-50` and `navy-100` hover and pressed on white buttons over navy), redaction tokens (`navy-100` fill,
  `navy-900` text), selection highlight (`navy-100`), progress tracks, the quiet "checked after the stop" icon.
- **Deep Night Navy** (`navy-950`): code blocks on the How it works page (marked `data-surface="navy"`), the pressed
  primary button, and modal and menu backdrops at 20 to 30 percent.
- **App Navy** (`navy-app`): defined from the brand's patient app screens and paired with `on-navy-soft` in the
  contrast notes, but not used by any screen today. Reserve it for a future dark app surface; do not use it as a
  second brand navy.

### Secondary: the state tints
Each tint pairs a background with a text colour (and sometimes a stronger icon colour). A tint is used only for its
state.

- **Mint** (`success-bg` with `success-fg`, icon `success-icon`): ready to send, checks passed, fact found. The trail
  connector between passed steps is `success-icon` at 45 percent.
- **Pale Sky** (`info-bg` with `info-fg`): information, "write the reply" (a person writes it), citation numbers,
  the Concept pill in the top bar, a highlighted source after a citation click.
- **Lavender** (`clinician-bg` with `clinician-fg`, chart accent `clinician-accent`): the clinician route, a
  clinician stop, clinical question and side effect categories.
- **Pale Red** (`urgent-bg` with `urgent-fg`, solid `urgent-solid`): urgent, crisis, adverse event and bereavement;
  the urgent stop; the destructive button (`urgent-solid`).
- **Amber** (`hold-bg` with `hold-fg`, icon `hold-icon`): orders on hold and the "stop sending" request.
- **Butter** (`warning-bg` with `warning-fg`): flagged steps, low confidence, "AI resting: rules only", the
  "Sample results" chip, the "Held: clinician first" lock, and a fact only the patient wrote ("The patient's own words,
  check first", with the note above Send). Each asks a person to look before anything goes; none is a failure.
- **Blush** (`error-bg` with `error-fg`): form errors, a blocked draft, a fact not found in the sources. Kept
  separate from urgent so a system failure never reads as a patient emergency.

### Neutral
- **Warm Paper** (`canvas`): the page. Also the browser theme colour.
- **White** (`surface`): cards, the top bar, menus, dialogs.
- **Evidence Grey** (`inset`): blocks inside a card (trail evidence, quotes, source text). Never a nested card.
- **Control Blue Grey** (`field`, hover `field-hover`): input fill, subtle buttons, the segmented control track, the
  active nav link, neutral chips.
- **Warm Stone** (`panel`): a second neutral layer for rails and toolbars. Defined but barely used today.
- **Ink** (`ink`): body text. **Heading** (`heading`, equal to `navy-900`): titles and primary labels.
- **Muted Slate** (`muted`): secondary text. The brand's own muted grey (`muted-icon`) is 4.46:1 on white, just under
  AA, so it is kept for icons and other non-text marks only.
- **Lines**: `line` on canvas and panel, `line-cool` inside white cards, `line-strong` for dividers that must read,
  secondary button borders and the dashed "skipped" spine, `control-line` for form control borders.
- **Disabled** (`disabled-bg` with `disabled-fg`) and **Selected** (`selected-bg`, with a 1px inset navy ring at
  25 percent): the open queue row, the pressed icon button, the chosen persona.

### Contrast pairs (WCAG 2.2, checked)

Text pairs, all at least 4.5:1:

| Foreground | On | Ratio |
|---|---|---|
| `ink` | `surface` / `canvas` / `field` | 14.63 / 13.45 / 13.14 |
| `navy-900` | `surface` / `canvas` / `selected-bg` | 19.64 / 18.06 / 17.00 |
| `muted` | `surface` / `canvas` / `field` / `inset` / `field-hover` | 5.69 / 5.24 / 5.11 / 5.36 / 4.79 |
| white | `navy-900` / `urgent-solid` / `clinician-fg` | 19.64 / 6.93 / 7.57 |
| `on-navy-muted` | `navy-900` | 11.05 |
| `success-fg` | `success-bg` | 5.70 |
| `info-fg` | `info-bg` | 5.17 |
| `clinician-fg` | `clinician-bg` | 6.01 |
| `urgent-fg` | `urgent-bg` | 6.58 |
| `hold-fg` | `hold-bg` | 6.70 |
| `warning-fg` | `warning-bg` | 5.74 |
| `error-fg` | `error-bg` | 5.94 |

Non-text pairs, all at least 3:1: `focus` on `surface` 4.81 and on `canvas` 4.42; `focus-on-navy` on `navy-900`
9.48; `success-icon` on `success-bg` 3.53; `hold-icon` on `hold-bg` 4.50; `clinician-accent` on white 3.53;
`muted-icon` on white 4.46; `control-line` on white 3.71 and on canvas 3.41. The `field` fill alone is 1.11 on white,
so the `control-line` border carries every input's edge. Disabled text on `disabled-bg` is 2.64, exempt under WCAG
1.4.3 and always paired with a not-allowed cursor.

The full table, including panel and inset pairs, is kept in the header comment of `app/globals.css`. Any new pair
gets measured and added there before it ships.

### Named Rules
**The Closed Palette Rule.** Tailwind's default palette, type scale and font stacks are reset to nothing
(`--color-*: initial`). Only the tokens above exist, so a screen cannot drift off-brand. Add a token to
`globals.css` with its contrast figures before using a new colour; never inline a hex in a component except the
few on-navy trail and toast tints already documented in code. The welcome headline's accent ("drafted in seconds.")
reuses the trail's on-navy mint (`#9ee8bd`, from `TrailMini.tsx`) for that reason.

**The One Meaning Rule.** Each tint means one state. Mint is never decoration, red is never a system error, amber is
only a hold. If a new state needs colour, it needs a new token and a new word.

## Typography

**Display Font:** Clash Display 500 (falls back to Poppins, then the system sans)
**Body Font:** Poppins 400, 500 and 600 (falls back to ui-sans-serif, system-ui, Segoe UI, Roboto, Arial)
**Mono:** the platform monospace stack, for record ids and code only

**Character:** Clash Display gives page titles a confident, slightly condensed brand voice; Poppins keeps every
working surface round, friendly and familiar. Both are self-hosted woff2 files in `public/fonts`, loaded through
`next/font/local` with `display: swap`. Only the weights the UI sets are loaded; emphasis uses 600, so no bold file is
requested.

### Hierarchy
The scale is a fixed rem scale with a ratio near 1.2. There is no fluid type; responsive steps are explicit at `sm`
(and, for the welcome hero only, at `lg` and `xl`).

- **Display, hero** (Clash 500, tracking -0.005em, balanced, white on navy): the welcome promise only. It steps
  2.5rem / 1.08 on phones, 3.25rem / 1.08 from `sm`, 3rem / 1.06 at `lg` (1024px to 1279px, where the text column
  is narrower) and 3.625rem / 1.04 from `xl`. The measure is 13ch, widened to 15ch at `lg` only.
- **Display, page** (Clash 500, 1.75rem / 2.25rem, up to 2.0625rem at `sm`): the one `h1` per page, through
  `PageHeader` or the desk and clinician headers.
- **Wordmark** (Clash 500, 1.4375rem; 2.0625rem at size `lg`): "Care Desk" in the top bar and, in white, at the top
  of the welcome hero.
- **Title** (Poppins 600, 1rem / 1.5rem): card headers, the check trail heading, section headings inside screens.
- **Body large** (Poppins 400, 1rem / 1.5rem): patient message text, page descriptions, Read mode prose. Measure
  62 to 70ch; message text 68ch.
- **Body** (Poppins 400, 0.875rem / 1.375rem): the default size of the whole app (set on `body`), trail summaries,
  table cells, notices, form controls.
- **Label** (Poppins 500, 0.75rem / 1.125rem): chips, hints, captions, meta rows, small buttons.
- **Micro** (Poppins 600, 0.6875rem / 1rem): the "Stopped here" and "Blocked" tags, count pills, keyboard keys.

Figures that are times, amounts, ids or counts use the `tnum` utility (tabular, lining numerals) so columns align.
Headings get `text-wrap: balance`, paragraphs `text-wrap: pretty`.

### Named Rules
**The Two Voices Rule.** Clash Display appears in exactly two places: the page title (`display-title` utility) and
the wordmark. Never in labels, buttons, numbers, card titles, chart labels or data. Big numbers on report screens are
Poppins 600.

**The No Eyebrow Rule.** No kicker or eyebrow text above a heading. The title carries itself.

## Layout

The app frame is a sticky 64px white top bar with a cool bottom rule, a `main` landmark, and the concept footer on
every screen. Standard pages sit in a centred container up to 1440px wide with 16px side gutters on phones, 24px from
`sm` and 32px from `lg`, and 24px to 32px vertical padding. The welcome content is capped at 1200px and the clinician
detail column at 1180px.

Breakpoints are Tailwind's defaults: `sm` 640px, `md` 768px (the welcome's three-column rows and the How it works
photo cards only), `lg` 1024px, `xl` 1280px, `2xl` 1536px. The structural change happens at `lg`:

- **Desk**: from 1024px a full-height grid: the queue (18.5rem) and the conversation (1fr), the message with the reply
  under it, centred at a readable width (46rem, 50rem at `2xl`). From `xl` the details are a third track (queue 20rem,
  details 20rem; 22rem and 24rem at `2xl`) that is 0 wide until **Show details**: the track eases open over 300ms, the
  details slide in from the right edge at full width (never squeezed), and the conversation re-centres with it. This
  is the desk's one authored motion; it is off during the tour and under reduced motion. Between 1024 and 1279px the
  details open under the reply instead, scrolled into view with focus on them. The reply panel owns the trail's state
  and renders the trail card into the details' slot (a portal), so resizing never loses an edit; while the details are
  closed the trail still runs out of view, so "Running the checks" in the reply is real. The window does not scroll;
  each column scrolls on its own, and the concept footer becomes a slim bar inside the frame. Below 1024px it becomes
  a stacked flow: the queue, then the message with a sticky "Back to the queue" sub-bar and the reply, then the details
  when asked for.
- **Clinician**: the same idea in two columns (queue 20rem to 24rem, detail 1fr). The escalation sits at 46rem; from
  `xl`, Show details widens it and opens a 340px column for the hold and the patient.
- **Welcome**: the hero is two columns from `lg` (text 1.15fr, photo 1fr; from `xl` the photo column is capped at
  33rem), one column below with the text first, so a phone's first screen shows the headline and both buttons. The
  text sits straight on navy. The agent photo sits in a 24px frame (full width and 5:4 on phones; 4:5 and right
  aligned from `sm`), and the live demo card overlaps its lower left edge (up to 27rem wide from `sm`; on a phone
  it overlaps the photo's foot with a 12px inset). A faint `leaves-deep` texture sits on the photo side only, from
  `lg`, masked out before it reaches the text. Below the hero, in order: "How a message moves" (three steps in a
  row from `md`, stacked below, each a 24px-rounded picture, a small navy step number, a title and one or two
  sentences; the middle step is the product, the routine example's seven checks on a white panel over
  `leaves-light`); "What keeps it safe" (a
  full-width `leaves-light` band with the three promises and the one sample note on a solid white panel, three
  columns from `md`, figures from `meta.json`, never typed in); "Talk to me" (a white card: the headshot, the
  first-person line, Email me and LinkedIn, the address written out, and beside it "How I would set it up with your
  team" in three one-line stages: Weeks 1 to 2, Weeks 3 to 4, Days 31 to 90); and "Explore the demo" (three door
  cards: Open the desk, See the test results, How it works; then quiet text links to the Clinician queue, Insights
  and Try your own message). The heading id `welcome-team-title` is the target of the Help menu's About me.
- **Top navigation**: inline links from `lg`; below that a menu button opens a full-width popover sheet.
- **Check evidence**: a container query switches the fact check from a stacked list to a table when its own column
  is wide enough, whatever the viewport.

Spacing uses Tailwind's 4px base. The rhythm in use is tight inside a group (4px to 12px between a label and its
control, a chip and its neighbour, steps of the trail at 12px compact or 16px full) and generous between groups
(16px to 32px between cards and sections, more space above a heading than below). Card padding is 16px on phones and
24px from `sm` (32px for the large variant).

Sticky bars declare themselves (`data-subbar`, `data-bottombar`), and the root scroll padding reads their heights, so
a control that takes focus or an anchor jump never lands under a sticky bar.

## Elevation & Depth

A hybrid system: tonal layering first (warm canvas, white card, grey inset), then soft navy-tinted shadows that carry
an offset and a diffuse blur. Nothing uses a zero-offset glow or a hard block shadow.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 2px rgb(1 3 55 / 0.04), 0 6px 20px -10px rgb(1 3 55 / 0.12)`): every card at rest,
  with a 1px ring in `line` at 70 percent.
- **Raised** (`box-shadow: 0 2px 4px rgb(1 3 55 / 0.05), 0 12px 28px -12px rgb(1 3 55 / 0.18)`): a focal card, such
  as the white panel on the welcome's eucalyptus band, the checks panel in the welcome's middle step, and a welcome
  door card on hover.
- **Pop** (`box-shadow: 0 4px 10px -2px rgb(1 3 55 / 0.08), 0 20px 44px -14px rgb(1 3 55 / 0.28)`): anything in the
  top layer: menus, tooltips, toasts, the shortcuts dialog, the mobile navigation sheet, the tour card. The welcome's
  demo card also takes it, because it floats over the hero photo.
- **Button lift** (`0 1px 2px rgb(1 3 55 / 0.18)`) on primary buttons, and a small two-part lift on the selected
  segment of a segmented control.

### Named Rules
**The Inset, Not Nested Rule.** A card never sits inside a card. Content that needs its own block inside a card uses
the `Inset` (grey fill, 12px radius, no shadow). Evidence inside the trail is always an inset.

**The Top Layer Rule.** Overlays (menus, tooltips, the mobile nav, dialogs) use the popover API or `<dialog>` in the
top layer, so they are never clipped by a scrolling column, and they all take the Pop shadow.

## Shapes

Soft, rounded and consistent, taken from the brand's site and app.

- **Cards** (24px): every white card, the welcome's floating demo card, the mini trail frame, the shortcuts dialog,
  and photo frames (the hero, the three journey steps, the eucalyptus panel on Test results).
- **Controls** (16px): medium and large buttons, inputs, selects, text areas, notices, toasts, menus, the segmented
  control track.
- **Inner** (12px): small buttons, icon buttons at small size, segmented options, tooltips, insets, trail evidence,
  stop boxes, row hover shapes.
- **Token** (6px): redaction placeholders, citation numbers, record id codes, keyboard keys.
- **Pill** (fully round): chips, risk and hold badges, filter pills, count pills, trail status icons, avatars,
  progress tracks.

Borders are 1px and quiet; lines divide, they do not decorate. The only 2px lines are the trail connectors and the
selected tab underline. There are no coloured side stripes on cards, rows or notices.

## Imagery

Photos carry the human story; the product carries the proof. The people are photographed, and the real product UI
(the live trail, the checks) sits beside or over them.

**The set** (`public/images`, WebP, cropped and compressed, each at two widths):

| Name | Widths | Aspect | Subject | Used on |
|---|---|---|---|---|
| `agent` | 560, 960 | 4:5 | Support agent in headphones at her laptop | Welcome hero (the one eager image there); How it works, Where a person decides; Insights, the How drafts were used empty state (small round crop) |
| `patient` | 720, 1200 | 4:3 | A woman texting on a sofa, her dog beside her | Welcome, How a message moves, step 1 |
| `clinician` | 720, 1200 | 4:3 | Clinician on a video call with a patient | Welcome, How a message moves, step 3; How it works, Where a person decides |
| `leaves-light` | 1200, 2000 | 16:9 | Pale eucalyptus sprigs on white | Welcome, behind the step 2 checks panel and the What keeps it safe band; How it works, beside In short |
| `leaves-deep` | 1200, 2000 | 16:9 | Deeper green eucalyptus, softly blurred | Welcome hero texture (photo side only, faint, masked); Test results, the How it was tested panel |
| `beam` | 240, 480 | 1:1 | The builder's own headshot | Welcome, Talk to me; the tour's closing card |

- **Never inside the work tools.** No photo on the desk, the clinician queue, the case table, the check trail or
  Try it. A photo also never stands in for a named fictional person: Try it shows the chosen patient's initials
  avatar, not the stock patient photo.
- **The `Photo` component** (`components/ui/Photo.tsx`): `<Photo name="agent" sizes="..." priority />`. It renders a
  plain responsive `img` (the export is static and unoptimised) with both widths in `srcSet`, `width` and `height`
  from the larger width and the crop's aspect, `loading="lazy"` and `decoding="async"`, and `object-cover` so it
  fills its frame. `priority` (eager, `fetchPriority="high"`) is only for the one above-the-fold image of a page: the
  welcome's agent photo and the How it works In short leaves. The wrapper sets the size, aspect and radius (24px
  card, 12px inner, or a pill for round crops); crop with `object-position`, never stretch. The `PHOTOS` map holds
  each photo's widths, aspect and default alt.
- **Alt text.** People photos use their default descriptive alt ("A support agent reading a message at her desk").
  Eucalyptus is always decorative (`alt=""`). The headshot's alt is "Chanon Poovaviranon (Beam)", except where the
  name is written right beside it (the welcome's Talk to me), where it is `alt=""`; the small round agent crop on
  Insights is also `alt=""`.
- **Text never sits on a photo.** Text over or near a photo goes on a solid panel (the safety band, the step 2
  checks, the Test results facts) or beside it; the hero texture stops before the text. Text keeps 4.5:1.
- **Licence and credits.** All photos except the headshot are from Unsplash, free under the Unsplash License
  (attribution optional). Each source is listed in `public/images/credits.txt`; add any new photo there.
- **Eucalyptus is the texture.** It is the brand world's botanical note (Australian, calm) and its sage greens sit
  with the mint tints. It is not cannabis: never use cannabis imagery, and no Dispensed logo or artwork.

## Components

The vocabulary is small and repeats everywhere. If the same action looks different on two screens, one of them is
wrong.

### Buttons
- **Shape:** 16px radius at medium (40px tall) and large (48px); 12px radius at small (32px). Poppins 500.
- **Primary:** navy fill, white text, a small lift shadow. Hover `navy-700`, pressed `navy-950`. One per region.
- **Secondary:** white with a `line-strong` border and navy text; hover fills `field` and warms the border to
  `navy-300`.
- **Subtle:** `field` fill for toolbar and low-emphasis actions. **Ghost:** text only, with a 6 percent navy hover
  wash. **Destructive:** `urgent-solid` fill, only for removing or discarding.
- **On navy:** white fill with navy text, or a white 30 percent outline ghost, for the welcome hero: **Start the
  1-minute tour** is the white primary, **Open the desk** the outline ghost.
- **States:** every button presses to 98 percent scale; disabled uses `disabled-bg` and `disabled-fg` with a
  not-allowed cursor; loading swaps the leading icon for a spinner, keeps the width, blocks clicks and announces a
  loading label. A keyboard shortcut hint can sit at the right edge from `lg`.
- **Icon button:** square at the same heights, always with an accessible label that doubles as its tooltip; a
  pressed toggle takes `selected-bg` and a faint navy ring.

### Chips and badges
- **Chip:** a non-interactive pill tag (24px, or 28px at medium) in one tone: neutral, info, success, clinician,
  urgent, hold, warning, navy or outline. Message categories map to tones: clinical question and side effect are
  lavender, adverse event, crisis and bereavement are red, stop sending is amber, everything routine is neutral.
- **Risk badge:** where a message stands, always icon plus words: Ready to send (mint, check), Write the reply (sky,
  person), Clinician (lavender, stethoscope), Urgent (red, siren). Weight 600.
- **Hold badge:** "Orders on hold" or "2 orders on hold", amber with a pause icon. In the desk and clinician queue
  rows a short "On hold" pill (`HoldPill` in `components/desk/StatusBadge.tsx`) keeps the row to one line of chips;
  screen readers still hear that orders are on hold.
- **Lock badge:** "Held: clinician first" (butter, shield) and "Withdrawn" (neutral, ban), for a patient-level lock.
- **Sample chip:** "Sample results", butter with a flask icon. It is a toggletip button: a press opens the one plain
  sentence saying what is a sample and what is real, and it stays open until the next press or Escape, so it can be
  read on a phone. One per page, in the page header (the `PageHeader` meta slot, or the desk and clinician headers)
  or once on the welcome's safety band, never one per card.
- **Concept pill:** a small sky pill beside the wordmark (a translucent white pill on navy).

### Filters, tabs and segmented controls
- **Filter pills** (desk and clinician queues): 32px pills, white with a line; the selected one is solid navy with
  white text and a muted count. They behave as a radio group with arrow keys, and each carries a short description
  tooltip. On narrow widths the row scrolls sideways with a soft edge fade.
- **Tabs:** 40px text tabs with a 2px navy underline on the selected tab and an optional count pill; arrow keys,
  Home and End; a right-edge fade shows when more tabs are off screen.
- **Segmented control:** a `field` track with 4px padding; the chosen segment is white with a small lift. Used for
  choices such as the mobile "Viewing as" switcher and the welcome demo's reduced-motion example switch.

### Cards and containers
- **Corner Style:** 24px.
- **Background:** white on warm canvas.
- **Shadow Strategy:** Card shadow at rest, Raised for the one focal card (see Elevation & Depth).
- **Border:** a 1px `line` ring at 70 percent; a selected card takes a 2px navy ring.
- **Internal Padding:** 16px on phones, 24px from `sm`; 32px for the large variant.
- **Card header:** a Poppins 600 title, an optional muted description, actions on the right that wrap below on
  narrow widths.
- **Quiet panel** (`QuietPanel` in `components/insights/sections.tsx`): the second tier on Insights, a 24px white
  panel at 70 percent with a hairline ring and no shadow, straight on the canvas, so it reads below the main cards.
- **Page header** (`PageHeader`): the page title, one short line under it (capped at 62ch) and at most one chip or
  notice inline after it, usually the page's single "Sample results" note; actions on the right.

### Inputs and fields
- **Style:** `field` fill, a 1px `control-line` border, 16px radius, 44px tall (text areas from 96px and optionally
  growing with content). Placeholder text in `muted`.
- **Hover:** `field-hover` fill and a darker border.
- **Focus:** the fill turns white, a 2px focus outline sits on the field itself, plus a soft 4px focus halo.
- **Error:** a red border, a faint blush fill, and an error line under the field with an icon that names the problem
  and the fix, announced politely when it appears. Focus stays in the control.
- **Disabled and read only:** disabled uses the disabled pair; read only uses the `inset` fill.
- **Field wrapper:** label (500), optional hint under it, optional right-aligned aside such as a character count;
  "(required)" is written in words, not an asterisk.

### Notices, toasts, tooltips and empty states
- **Notice:** an inline tinted block (16px radius, 14px padding) with an icon, an optional title in the tone's text
  colour and body in ink. Tones: info, success, warning, error, hold, clinician, neutral. Used for sample labels,
  rate limits, "AI resting" and failures with a recovery action.
- **Toast:** navy, white text, Pop shadow, rising in over 240ms. For completed actions such as "Sent. Next message
  opened." with Undo. Six seconds, or eight with Undo, paused on hover or focus; at most two at once. On large
  screens it sits bottom right, never over the queue; on smaller screens under the top bar. It moves if it would
  cover the focused element or a sticky bar.
- **Tooltip:** small navy tip in the top layer, shown after a short hover delay or at once on keyboard focus,
  hoverable, closed by Escape. Anything a touch user must read uses toggle mode instead.
- **Empty state:** a round `field` icon well, a title and a line that teaches what normally appears here ("All caught
  up" plus what happens next), never just "Nothing here". On Insights, "How drafts were used" puts a small round
  agent photo in the well, with an Open the desk button. On Try it, the empty Live trail shows the chosen patient's
  initials avatar with a small navy message badge, "Write as {name} and press Run the checks", the seven checks
  waiting quietly where the live trail will draw them (so nothing jumps when a run starts), and one closing line.
- **Skeleton:** a shimmering `field` to `inset` placeholder that keeps the final layout, paired with a screen reader
  loading status. No spinners in the middle of content.

### Navigation
- **Top bar:** wordmark and Concept pill on the left, then five quiet links (Desk, Clinician, Insights, Test
  results, How it works), then "Try it" as a small outlined pill with a pen icon at the right end of the same
  Primary list, then Help and the account menu. Nothing else sits in the bar.
- **Links:** 36px, 12px radius, muted text at regular weight; hover lifts to heading colour with a faint navy wash;
  only the current page has a `field` fill, heading colour, weight 500 and `aria-current`. The Try it pill is white
  with a `line-strong` border, and takes the `field` fill when it is the current page.
- **Account menu:** the signed-in fictional person's avatar (plus first name and role from `xl`) and a chevron. Its
  menu opens with "Signed in as {name}, {title}", then the "Viewing as" radios. The switch moved here from the bar
  because the role already follows the page (`roleForPath`); choosing a role still goes to that role's page, and the
  session staff still follows the role. The trigger's accessible name is "{name}, viewing as {role}".
- **Mobile:** below 1024px a menu button opens a full-width sheet under the top bar with all six links (Try it last,
  as a plain link), then Replay the tour, Keyboard shortcuts, Reset the demo and About me, then one block with the
  signed-in person and the "Viewing as" segmented control.
- **Skip link:** a navy pill that appears on focus at the top left.
- **Help menu:** Replay the tour ("Two minutes, six steps"), Keyboard shortcuts (a dialog listing every key, with a
  switch to turn one-key shortcuts off), How it works, **About me** ("Who built Care Desk, and how to reach me",
  linking to the welcome's Talk to me section through `BUILDER_ABOUT_HREF`), then Reset the demo.

### Concept footer
Required on every screen, in muted label type above a warm rule. It is one centred line on a wide screen (two short
centred lines on a phone): the fixed notice (`CONCEPT_NOTICE` in `components/shell/ConceptFooter.tsx`, never
reworded: "Concept for Dispensed. Not affiliated with Dispensed. All patients, orders and messages are
fictional."), then the byline "Built by Chanon Poovaviranon (Beam)", Email and LinkedIn. The name is in the byline
only, once; the notice does not contain it. `hideByline` drops only the name (the notice and both links stay): the
welcome passes it, because its Talk to me section names the builder on the same screen. On the full-height desk and
clinician screens the footer becomes one slim bar inside the frame.

### Iconography
- **Library:** `lucide-react` only, at its default stroke, one consistent line style. No emoji or unicode glyphs as
  icons, no second icon set.
- **Sizes:** 12px in small chips, 13px to 15px in badges and status icons, 14px, 16px and 18px in small, medium and
  large buttons (icon buttons add 2px), 16px in menus, disclosures and source rows, 18px in notices and the mobile
  menu, 20px for the Help button, 22px in empty states.
- **Colour:** decorative icons take `muted-icon`; icons inside a tone take the tone's text or icon colour.
- **Always paired with words:** icons are `aria-hidden`, and the meaning is in the text beside them.
- **Trail glyphs:** Check (passed), Hand (stopped), X (blocked), Triangle alert (flagged), Minus (skipped),
  spinning Loader (working), Person or Stethoscope (a person or a clinician decides), a small dot (waiting).
- **Browser tab icon:** a navy rounded square with a white check, drawn inline. No logo or brand artwork anywhere;
  the only images are the photos under Imagery.

### Motion
- **Durations:** 150ms for hover, press and colour changes; 200ms for expand and collapse, chevrons and step
  transitions; 220ms for the tick and rise-in keyframes; 240ms for toasts. Nothing in the working UI runs longer
  than 250ms except the trail sequence and the shimmer.
- **Easing:** exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`) for almost everything; a quartic ease-out is
  available.
- **Vocabulary:** `tick` (a status icon scales up from 60 percent), `rise-in` (text settles 4px upward from 40 percent
  opacity, starting visible), `toast-in`, `shimmer` for skeletons, `spin` for loaders, and the grid-rows
  `collapsible` for every expand and collapse.
- **The one authored moment:** the trail reveal (see The check trail). Nothing else animates for show; there are no
  page-load sequences.
- **Reduced motion:** a global rule ends every animation and transition at once. The trail shows its end state
  immediately, and scrolling is instant. The welcome demo plays nothing on its own: a two-button switch (Order
  question, Medication question) shows each example at its end state, one press apart, and the change is announced
  politely.

### The check trail (signature component)
The trail (`components/trail/Trail.tsx`) is the product's form. It is a vertical ordered list of seven steps, always
in this order and always all seven, with placeholders filling any gap:

1. Personal details removed
2. Safety rules
3. Sorted by type
4. Sources found
5. Reply drafted
6. Facts checked
7. A person decides

- **Anatomy:** each step is a round status icon (28px, or 20px compact) on a 2px spine, a Poppins 600 title and a
  one-line plain summary. The spine segment is mint after a pass, blush after a block, dashed `line-strong` into and
  after anything skipped, and `line-cool` otherwise.
- **On the desk:** the trail card sits in the details (Show details), and opens folded: the title, one toggle (Show steps, Hide steps, Show less), the verdict
  line, and one row of the seven ticks with the time taken. **Show steps** lists the seven steps one line each (the
  tour's check trail stop shows this list); a step opens the full trail with that step's evidence. Elsewhere (the
  clinician's fold, Try it, Test results) the full trail keeps its own header.
- **Header:** the title "Check trail", the total time in plain words ("Checked in under a second"), Expand all or
  Collapse all, and the verdict line: a risk badge (or a lock badge), a hold badge when orders are held, and one
  sentence that answers "what happened?" in about three seconds, such as "Checked draft ready. A person reviews it,
  then sends." The verdict keeps its space while the trail runs, so nothing jumps.
- **States:** passed, stopped, flagged, skipped, blocked (failed), waiting, working, and waiting for a person. Each
  has its icon, its tint, and a screen reader status word after the title.
- **Evidence:** every step that has evidence is a button with `aria-expanded` that opens an inset under it: the
  redacted text with placeholders drawn as tokens ("See what the AI saw"), the rule hits highlighted in their
  sentence, the sorter's type and confidence bar, the sources, the draft with numbered citations, and the fact check
  table. A citation number opens Sources, scrolls to the source and highlights it in sky for about two seconds. On
  phones the evidence spans under the icon column for full width.
- **Decide step:** names who decides and where the decision stands ("Waiting for you to send, edit or escalate the
  draft"). It shows a person icon, or a stethoscope on a safety route. On the desk the actions themselves (Send,
  Edit, Escalate) sit in the reply card under the message, never in the trail.
- **Blocked draft:** a blush box under Facts checked names each fact not found in the sources and ends "A person
  writes this reply."
- **Check first:** a date or time the sources do not hold but the patient wrote in their own message passes the fact
  check as "The patient's own words, check first" (butter, a quote icon), never with a source chip. The desk repeats
  it above Send ("1 detail comes from the patient's own message. Check it before sending."), and Send stays on. An
  amount worked out from two cited ones reads "Worked out from NZ$162 minus NZ$149" beside its source. An order past
  its estimated delivery date shows that line on its own under the record, and the draft names the patient's other
  recent messages it read as context (linked, never cited).
- **Sample runs:** when a built-in stand-in played the AI part, the affected rows carry a small grey "Sample" tag
  (with a spoken explanation) instead of repeating a sentence on every row; the footer line says "sample run without
  Claude" instead of the AI cost.
- **Footer:** rules version, prompts version, and the AI cost or the sample note, in muted label type.
- **Mini trail** (`TrailMini.tsx`): a compact, non-interactive version, in a navy or a light tone, with a status
  word per row and an outcome line. On the welcome it uses the light tone inside the white demo card that floats
  over the hero photo: the patient's message, the trail, then the payoff (the first lines of the checked draft, or
  what the clinician gets). The loop runs two cases in turn, holds each outcome about four seconds, has a Pause
  control and pauses on hover or focus. The card reserves the height of its tallest example, so the page below never
  moves as the loop switches. Screen readers get one plain sentence instead of the animation.

### The safety stop (signature moment)
The loudest thing in the system, reserved for a clinical question, side effect, adverse event, crisis or bereavement.

- **Sequence:** after a 160ms opening beat, steps tick in every 120ms. When a step stops, the sequence holds on it for
  420ms, then every later step settles together as skipped and the decide step lands last.
- **The stopped step:** a solid filled icon with a Hand glyph, lavender (`clinician-fg`) for a clinician stop or red
  (`urgent-solid`) for an urgent one, and a solid "Stopped here" tag beside the title. These are the only solid
  saturated fills in the trail.
- **The stop box:** a tinted inset (lavender or pale red) rising in under the step: the reason in plain words
  ("Side effect and clinical question"), where it went ("Sent to the clinician queue" or "Top of the clinician
  queue"), the words that triggered it, and when orders are held, the amber hold badge with "Nothing ships until a
  clinician resumes the orders."
- **After the stop:** later rows turn quiet and short ("Skipped after the stop"), the draft slot reads "No AI reply
  for this one. A clinician will answer.", and a check that still ran afterwards is retitled "Double-checked for
  anything urgent" with a neutral icon, never a green pass that reads as the message carrying on.
- **Highlight marks** follow the stop: red only for urgent, lavender for a clinician stop, amber for a hold request
  on a routine message.

### Named Rules
**The Words Beside Colour Rule.** No state is shown by colour alone. Every badge, step and row carries an icon and a
word, and every trail step has a spoken status.

**The Stop Is Loud Rule.** Solid saturated fills belong to the safety stop and the destructive button. Nothing
routine may borrow them.

**The Person Sends Rule.** The reply card under the message is the only place a reply leaves the desk, and the
trail's decide step always shows a person (or a clinician) as the one deciding.

## Do's and Don'ts

### Do:
- **Do** put new screens on the warm canvas with white 24px cards, 16px controls on `field`, and pill tags.
- **Do** use `PageHeader` for every page title, so Clash Display stays in its two places.
- **Do** show state as a risk, hold or lock badge (icon plus words plus tint) and reuse the existing tones.
- **Do** put evidence inside an `Inset`, and expand it inline with `Disclosure` or the trail's own step buttons.
- **Do** give every interactive component its hover, focus, pressed, disabled, loading and error states, and every
  region its empty and loading state.
- **Do** measure any new colour pair and record it in the `globals.css` header before shipping.
- **Do** label figures from the test set or the simulation with one "Sample results" chip per page (or a simulated
  label in the chart itself), and keep the concept footer on every screen.
- **Do** open each page with its answer in a screen or less, and fold the expert detail behind `Disclosure`, "Show
  all" or tabs. Fold it; never delete functionality, data or test evidence.
- **Do** use photos from `public/images` through `Photo`, on the story pages only, with the alt rules under Imagery.
- **Do** check every screen at phone width with a 16px gutter and no sideways page scroll.

### Don't:
- **Don't** use Clash Display for labels, buttons, card titles, numbers or chart text.
- **Don't** nest a card inside a card, add a coloured side stripe, use gradient text, glass effects or hard offset
  shadows.
- **Don't** add a kicker or eyebrow above a heading, or number sections 01, 02, 03.
- **Don't** use solid red or solid lavender for anything that is not a safety stop or a destructive action.
- **Don't** use the brand muted grey (`muted-icon`) for text; use `muted`.
- **Don't** open a modal for a task that can happen inline.
- **Don't** add decorative motion, a page-load sequence, or an animation that ignores reduced motion.
- **Don't** add a logo, illustrations or cannabis imagery, put a photo inside a work tool, or set text directly on a
  photo.
- **Don't** put a status chip on every card; a chip earns its place only where it changes what someone does.

### Content rules
- **Plain words.** Controls name their action ("Send", "Open the desk", "See what the AI saw"). Errors name the
  problem and the recovery. Verdicts are one sentence a non-technical reader understands at first glance; technical
  detail sits one click away in the evidence.
- **Australian and British spelling** throughout (colour, organise, centre). The document language is `en-AU`.
- **No em or en dashes** anywhere in UI copy: use commas, colons, full stops, or "to" for ranges.
- **Sample and fictional labels.** Every patient, order and message is fictional and says so. A run done by the
  built-in stand-in is called a "sample run", explained once per page behind the "Sample results" chip in the same
  sentence everywhere (`SAMPLE_RUN_TEXT` in `components/ui/SampleNotice.tsx`), and tagged "Sample" on trail rows.
  Simulated figures are marked simulated.
- **Generic product words.** "Your oil", "your order", "your treatment plan": no strain or brand names and no
  efficacy claims.
- **Fixed texts are fixed.** The concept notice and the sample sentence are shared constants; never reword them in
  place.
- **Stay inside the demo.** Copy never refers to real people or to anything outside the product story, apart from
  the builder: the footer byline, the welcome's Talk to me section, the Help menu's About me and the tour's closing
  card. The signed-in staff and all patients are fictional.
- **The builder speaks in the first person.** Every rendered line about the builder is first person: "I designed
  and built Care Desk", "Talk to me", "Email me", "About me", "Who built Care Desk, and how to reach me", "How I would
  set it up with your team". Never "he" or "the builder" on screen (code comments may stay third person). His name
  is always written "Chanon Poovaviranon (Beam)" and appears at most once per screen, as a plain byline or in the
  first-person introduction.
- **Short.** Short sentences, active voice, one idea per paragraph, two lines where possible. No marketing fluff.

### Accessibility commitments
- **WCAG 2.2 AA** is the floor on every surface, measured, not assumed (see the contrast pairs).
- **One focus language:** a 2px `focus` outline with a 2px offset everywhere (`focus-on-navy` on navy surfaces);
  inputs draw it on the field with a soft halo. The outline colour is set up front so a colour transition never fades
  the ring in.
- **Focus never obscured (2.4.11):** scroll padding reserves the top bar, any sticky sub-bar and the bottom Send bar;
  toasts move away from the focused element.
- **Keyboard first:** J and K to move through the queue, E to edit, Ctrl+Enter to send, X to escalate, / and ? for
  search and help. One-key shortcuts can be turned off (2.1.4), and the choice is remembered in this browser only.
  Tabs, filter pills and menus follow their ARIA patterns with arrow keys, Home and End.
- **Colour is never the only signal:** icon plus words on every state; trail steps carry spoken status words; the
  mini trail gives screen readers one sentence instead of the animation.
- **Live regions:** field errors are announced politely once; toasts live in a polite notifications region; a live
  run marks the trail busy while it streams.
- **Phones:** anything a touch user must read (the sample sentence, filter help) opens on press, not only on hover.
  Controls are at least 32px tall, most 40px to 48px.
- **Moving content can be paused (2.2.2):** the welcome loop has a Pause button and pauses on hover or focus.
- **Reduced motion is honoured** everywhere, with the end state shown at once.
- **Structure:** a skip link, one `h1` per page, labelled landmarks ("Primary" navigation, "Notifications" region),
  labelled icon buttons, and decorative icons and avatars hidden from assistive technology.
- **Images:** every photo has a real `alt`, or `alt=""` when it is decorative or its subject is named right beside
  it, plus `width` and `height` so nothing shifts as it loads.
