/**
 * Round 3 red-team redaction cases (lib/pipeline/redact.ts), grouped by category. Each row names the placeholder that
 * must appear and the pieces of the message that must not reach the AI. The guard rows are ordinary messages near the
 * new patterns, and must come back unchanged (or keep the words they list).
 */
import { describe, expect, it } from "vitest";
import { redact } from "@/lib/pipeline/redact";

interface Row {
  text: string;
  placeholder: string;
  hide: string[];
}

const CASES: Record<string, Row[]> = {
  "card numbers in wider groupings": [
    { text: "card 4111 1111 / 1111 1111", placeholder: "[CARD]", hide: ["4111", "1111"] },
    { text: "card 4111|1111|1111|1111", placeholder: "[CARD]", hide: ["4111"] },
    { text: "card 4111_1111_1111_1111", placeholder: "[CARD]", hide: ["4111"] },
    { text: "card 4111,1111,1111,1111", placeholder: "[CARD]", hide: ["4111"] },
    { text: "card: 4111 - 1111 - 1111 - 1111", placeholder: "[CARD]", hide: ["4111"] },
  ],
  "card numbers read out": [
    { text: "my card: four one one one, one one one one, one one one one, one one one one", placeholder: "[CARD]", hide: ["four one one one"] },
    { text: "card number five five five five four four four four three three three three two two two two", placeholder: "[CARD]", hide: ["five five"] },
  ],
  "phone numbers with look-alike letters or mixed words": [
    { text: "my num is O412 345 678", placeholder: "[PHONE]", hide: ["O412", "345 678"] },
    { text: "call me 04l2 345 678", placeholder: "[PHONE]", hide: ["04l2", "345 678"] },
    { text: "call 0412 345 678 or O413 222 333", placeholder: "[PHONE]", hide: ["0412", "O413", "222 333"] },
    { text: "ring me on O4l2 345 678 thanks", placeholder: "[PHONE]", hide: ["345 678"] },
    { text: "my number is 04one2 345 678", placeholder: "[PHONE]", hide: ["04one2", "345 678"] },
  ],
  "email handles and spaced emails": [
    { text: "my gmail is janedoe1988", placeholder: "[EMAIL]", hide: ["janedoe1988"] },
    { text: "my hotmail is bigjim_77", placeholder: "[EMAIL]", hide: ["bigjim_77"] },
    { text: "my gmail is jane.doe88", placeholder: "[EMAIL]", hide: ["jane.doe88"] },
    { text: "username on gmail: janedoe1988", placeholder: "[EMAIL]", hide: ["janedoe1988"] },
    { text: "my hotmail: bigjim_77", placeholder: "[EMAIL]", hide: ["bigjim_77"] },
    { text: "j a n e @ g m a i l . c o m", placeholder: "[EMAIL]", hide: ["j a n e", "g m a i l"] },
    { text: "it's j a n e 8 8 @ g m a i l . c o m", placeholder: "[EMAIL]", hide: ["j a n e", "g m a i l"] },
  ],
  "bank details and licences": [
    { text: "BSB 062-000 account 12345678", placeholder: "[REDACTED]", hide: ["062-000", "12345678"] },
    { text: "sort code 12-34-56 account 12345678", placeholder: "[REDACTED]", hide: ["12-34-56", "12345678"] },
    { text: "BSB: 062 000, acc no. 12345678", placeholder: "[REDACTED]", hide: ["062 000", "12345678"] },
    { text: "acct no. 12-3456-7890123-00 for the refund", placeholder: "[", hide: ["7890123"] },
    { text: "driver licence 12345678", placeholder: "[REDACTED]", hide: ["12345678"] },
    { text: "drivers licence 98765432", placeholder: "[REDACTED]", hide: ["98765432"] },
  ],
  "addresses and postcodes": [
    { text: "send to 10 downing street london sw1a 2aa", placeholder: "[ADDRESS]", hide: ["downing", "london", "sw1a", "2aa"] },
    { text: "my postcode's 3056", placeholder: "[ADDRESS]", hide: ["3056"] },
    { text: "my postcode’s 3056", placeholder: "[ADDRESS]", hide: ["3056"] },
    { text: "post code's 6011", placeholder: "[ADDRESS]", hide: ["6011"] },
    { text: "My address is 5 Kowhai St, Te Aro, Wellington 6011", placeholder: "[ADDRESS]", hide: ["Kowhai", "Te Aro", "Wellington", "6011"] },
    { text: "my address is 5 kowhai st, te aro, wellington 6011", placeholder: "[ADDRESS]", hide: ["kowhai", "te aro", "wellington", "6011"] },
    { text: "I moved to 14 smith st, carlton last week.", placeholder: "[ADDRESS]", hide: ["smith", "carlton"] },
  ],
};

/** Ordinary messages near the new patterns: each keeps the words listed. */
const GUARDS: [string, string[]][] = [
  ["I was away 22/09/2026 - 25/09/2026 so missed the courier.", ["22/09/2026 - 25/09/2026"]],
  ["The outlook is good for Friday apparently.", ["The outlook is good"]],
  ["My email is the same as before.", ["the same"]],
  ["My email is broken, can you text me?", ["broken"]],
  ["My gmail is down at the moment.", ["down"]],
  ["my account 3 weeks ago was fine", ["3 weeks"]],
  ["Can you refund to my account please?", ["my account please"]],
  ["My licence is suspended so I can't drive.", ["suspended"]],
  ["I live at 14 smith st, and the courier left it at 16.", ["and the courier left it at 16"]],
  ["It was delivered to 5 kowhai st, not 7.", ["not 7"]],
  ["I moved to 14 smith st, carlton last week.", ["last week"]],
  ["Order ORD-20481, tracking CD1234567890, please check.", ["ORD-20481", "CD1234567890"]],
  ["Vitamin b12 3rd time asking about my order", ["b12 3rd"]],
  ["The version is 2.1.0 on my phone", ["2.1.0"]],
];

describe("redaction: round 3 red-team cases", () => {
  for (const [category, rows] of Object.entries(CASES)) {
    for (const row of rows) {
      it(`hides (${category}): ${row.text}`, () => {
        const out = redact(row.text).redactedText;
        expect(out).toContain(row.placeholder);
        for (const h of row.hide) expect(out, `leaked "${h}"`).not.toContain(h);
      });
    }
  }

  for (const [text, keep] of GUARDS) {
    it(`keeps ordinary wording: ${text}`, () => {
      const out = redact(text).redactedText;
      for (const k of keep) expect(out).toContain(k);
    });
  }
});
