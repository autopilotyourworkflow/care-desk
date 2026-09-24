# Runbook

How to run Care Desk day to day. Every command runs from the project folder, with Wrangler signed in to the Cloudflare account that owns the site (`npx wrangler login` once). `--remote` means the live settings, not a local copy.

## What is running

- **The site** is static files (pages and the precomputed demo data), served by one Cloudflare Worker named `care-desk`.
- **The live box** ("Try it") is the same Worker's `/api/try` route. It runs the pipeline on the typed message, calls the Claude API with the key stored as a Worker secret, and streams the trail back.
- **Settings** live in one Workers KV namespace, bound as `CARE_DESK_KV`. It holds one `config` value (the limits and the on/off switch) and running counts (tries per visitor per hour, requests and spend per day). It never holds a typed message.
- **Secrets** are set with `npx wrangler secret put NAME` and can never be read back: `ANTHROPIC_API_KEY` (the Claude key), `VIP_TOKENS` (the private-link codes), `ADMIN_TOKEN` (for the status check below) and, if used, `TURNSTILE_SECRET` and `VISITOR_SALT`.
- **There is no database of patient data.** Every patient is fictional, and each visitor's decisions stay in their own browser.

## Raise or lower the live-box limits

One command. It takes effect within about a minute, with no redeploy.

```sh
npx wrangler kv key put --binding=CARE_DESK_KV --remote config '{"enabled":true,"dailyUsd":5,"perVisitorPerHour":20,"vipDailyUsd":10,"vipPerVisitorPerHour":60}'
```

The value replaces the whole `config`, so always write every field. A field that is missing or unreadable falls back to its default, and nothing can go above US$200 a day or 1,000 tries an hour, so a typo cannot switch the limits off.

| Field | What it limits | Default |
| --- | --- | --- |
| `dailyUsd` | Public spend per day, in US dollars | 3 |
| `perVisitorPerHour` | Public tries per visitor per hour | 10 |
| `vipDailyUsd` | Private-link spend per day, in US dollars | 10 |
| `vipPerVisitorPerHour` | Private-link tries per visitor per hour | 60 |
| `enabled` | The on/off switch (see "Pause the live box") | true |

Days are UTC. To see the current values:

```sh
npx wrangler kv key get --binding=CARE_DESK_KV --remote config
```

No output means the key is not set and the defaults apply.

## Add or revoke a VIP link

A VIP link is a private link for someone who needs more tries, such as a team lead trialling the live box. It has its own budget (`vipDailyUsd` and `vipPerVisitorPerHour`), separate from the public one, so public traffic can never use up a private link's allowance. It also skips the bot check.

1. Make a code that cannot be guessed (24 letters, digits, `-` or `_`; codes shorter than 12 characters are ignored):

   ```sh
   node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
   ```

2. Store every live code in the `VIP_TOKENS` secret, separated by commas. The secret cannot be read back and each `put` replaces the whole list, so keep the list somewhere safe, such as a password manager. Paste it when asked:

   ```sh
   npx wrangler secret put VIP_TOKENS
   ```

3. Send the link: `https://caredesk.autopilotyourworkflow.com/try/?k=CODE`

The page takes the code out of the address bar and keeps it for that browser tab only.

To revoke a code, run `npx wrangler secret put VIP_TOKENS` again with the list minus that code. It stops working as soon as the secret is saved. To see how many codes are live, use the status check under "Check spend".

## Rotate the API key

1. In the Claude Console, create a new key named `care-desk`.
2. Store it in the Worker. Paste it when asked; the Worker picks it up at once.

   ```sh
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

3. Send one message through "Try it" and check the trail reaches "Facts checked".
4. Revoke the old key in the Console.
5. Put the new key in `.env.local` too, so `npm run precompute` keeps working on this machine. Never commit it.

## Check spend

- **Today, as the Worker counts it** (US dollars, the day in UTC). Spend is kept per tier, so there are two keys; no output means nothing was spent:

  ```sh
  npx wrangler kv key get --binding=CARE_DESK_KV --remote spend:public:2026-09-24
  npx wrangler kv key get --binding=CARE_DESK_KV --remote spend:vip:2026-09-24
  ```

- **Everything in one view:** the status check returns today's spend, requests, limits and remaining budget for both tiers, whether the live box is on, and how many VIP codes are live. Set `ADMIN_TOKEN` once with `npx wrangler secret put ADMIN_TOKEN`, then:

  ```sh
  curl -H "Authorization: Bearer ADMIN_TOKEN_VALUE" https://caredesk.autopilotyourworkflow.com/api/status
  ```

- **The source of truth** is the Usage page in the Claude Console, filtered to the `care-desk` key. Set a monthly spend limit there as a backstop to the Worker's cap.
- **Live requests and errors** as they happen: `npx wrangler tail care-desk`

## Pause the live box

Write the `config` with `"enabled": false`, keeping the other fields as they are:

```sh
npx wrangler kv key put --binding=CARE_DESK_KV --remote config '{"enabled":false,"dailyUsd":5,"perVisitorPerHour":20,"vipDailyUsd":10,"vipPerVisitorPerHour":60}'
```

Within about a minute every live try, public and VIP, is turned away before any AI call. "Try it" shows the same notice as when the day's live AI budget is used up, and still runs the safety rules in the visitor's browser, with a simple built-in stand-in for Claude, labelled as a sample. The rest of the site is static and carries on as normal. To resume, put the same value back with `"enabled": true`.

In an emergency, removing the key stops every AI call at once: `npx wrangler secret delete ANTHROPIC_API_KEY`. The live box then answers with a simple built-in stand-in for Claude until a key is put back.

## Re-run the evaluation

Run this after any change to the safety rules, the prompts or the test set.

```sh
npm run precompute   # runs every demo message through the pipeline with Claude
npm run eval         # scores the results against the labelled test set
npm run deploy       # rebuilds the site data and publishes it
```

`precompute` keeps saved results that already match the current rules, prompts and models, so a second run only pays for what changed. To redo one message: `npm run precompute -- --only MSG-0042` (comma-separate several).

## What the release gate means

`npm run eval` is the release gate. It **fails (exit code 1)** when:

- any safety case in the test set was not sent to a clinician, or an urgent case lost its priority;
- any case that must hold the patient's orders did not;
- a draft could be sent to a patient whose death was reported, or to a patient with an open urgent message;
- a labelled message has no result, or the results came from the simple built-in stand-in instead of Claude.

**Do not deploy on a failed gate.** Fix the rule or the prompt, add the message that exposed the problem to `data/testset.json` as a new case, and run the three commands again. The Test results page shows exactly what the last passing run measured.
