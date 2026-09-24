/**
 * Red-team redaction cases (lib/pipeline/redact.ts), table driven. Each row is a test-only message from the red-team
 * slice (data/messages.json, MSG-0923 onwards) that carries personal details in disguised forms. Redaction runs the way
 * the pipeline runs it (lib/pipeline/run.ts): the subject and body together, with every name found anywhere in the
 * conversation, against the patient's own record.
 *
 *  - kinds: every kind of detail the case expects to be hidden must be hidden at least once;
 *  - hide:  these exact pieces of the message must not reach the AI;
 *  - keep:  these must survive (a public crisis line is not a personal detail).
 */
import { describe, expect, it } from "vitest";
import { conversationNames, redact } from "@/lib/pipeline/redact";
import type { Patient, PatientMessage, RedactionType } from "@/lib/types";
import messagesData from "@/data/messages.json";
import patientsData from "@/data/patients.json";

const MESSAGES = messagesData as PatientMessage[];
const PATIENTS = patientsData as unknown as Patient[];

interface RedactCase {
  id: string;
  kinds: RedactionType[];
  hide: string[];
  keep?: string[];
  what: string;
}

const CASES: RedactCase[] = [
  {
    id: "MSG-0938",
    kinds: ["name", "phone"],
    hide: ["Tane", "Rewi", "0491 575 254"],
    keep: ["13 11 14"],
    what: "his own mobile hidden, the Lifeline number he rang left in place",
  },
  {
    id: "MSG-0980",
    kinds: ["name", "dob", "health_id", "address", "phone"],
    hide: ["Karen", "Georgia", "McKenzie", "16th of Feb", "2347 39495 1", "Saltwater Lane", "0491 570 159"],
    what: "a birth date as 'would have turned 75 on the 16th of Feb' and an address as 'number 8 on Saltwater Lane'",
  },
  {
    id: "MSG-0927",
    kinds: ["address", "name"],
    hide: ["12 Bottlebrush Court", "Highfields", "4352", "Joe", "Tuala"],
    what: "a new address repeated inside a dictated confirmation sentence",
  },
  {
    id: "MSG-0930",
    kinds: ["card", "name"],
    hide: ["4622 9031 5578 1106", "Castellano", "Ben", "11/29"],
    what: "a card number with its expiry and the name on the card",
  },
  {
    id: "MSG-0933",
    kinds: ["name", "dob"],
    hide: ["Amelia", "Hughes", "29/11/1993"],
    what: "another patient's name and date of birth",
  },
  {
    id: "MSG-0975",
    kinds: ["email", "dob", "address", "health_id", "name"],
    hide: ["parata", "(dot)net", "kaimoana", "[dot] nz", "02-Nov-94", "1025", "zpj 4776", "Nikau"],
    what: "(dot)/(at) and [at]/[dot] emails, a hyphenated month DOB, a lower-case spaced NHI",
  },
  {
    id: "MSG-0988",
    kinds: ["phone", "name"],
    hide: ["0117", "496 0831", "900 482", "0044 7700 900519", "Oliver", "Brenda"],
    what: "UK numbers with brackets, +44 (0) and a 0044 exit code, and a neighbour named mid-sentence",
  },
  {
    id: "MSG-0993",
    kinds: ["address", "health_id", "name"],
    hide: ["Taigh na Faoileig", "Ardcorrach", "IV49 9ZX", "G11 6BU", "240974 1826", "Fiona"],
    what: "a house-name island address with no street, and a CHI number that starts with the date of birth",
  },
  {
    id: "MSG-0969",
    kinds: ["name", "health_id", "dob"],
    hide: ["PATRICK", "DOYLE", "204 118 395K", "03-Oct-81"],
    what: "a Centrelink CRN, a capitalised name on a card, and DOB 03-Oct-81",
  },
  {
    id: "MSG-0981",
    kinds: ["card", "name"],
    hide: ["4000  0566  5566  5556", "0566", "5556", "emily", "harcourt", "10/29", "318"],
    what: "a card number with double spaces, its expiry and CVV",
  },
  {
    id: "MSG-0974",
    kinds: ["phone", "name", "email", "dob"],
    hide: ["573 087", "5550 3172", "575 254", "kirra", "26/10/82"],
    what: "mobiles with the prefix in brackets, a landline with no area code, a partner named in lower case",
  },
  {
    id: "MSG-0987",
    kinds: ["address", "name", "phone", "dob"],
    hide: ["412 Pūkeko Gully Road", "Upper Moutere", "7173", "Tamihana", "Emma", "Clarke", "03 555 0164", "27 555 0199", "9 September 1969", "0622"],
    what: "an NZ rural address with an RD number, names on a letterbox, and +64 written without the plus",
  },
  {
    id: "MSG-0990",
    kinds: ["name", "email", "phone", "dob", "other"],
    hide: ["Caroline", "Hollis", "0113 496 0572", "twenty-sixth of March", "nineteen fifty-two", "QQ 12 34 56 C", "Eleanor", "Pike"],
    what: "a date of birth in words, a National Insurance number, a daughter named with no relation word",
  },
  {
    id: "MSG-0962",
    kinds: ["name", "phone", "email", "address", "health_id", "dob"],
    hide: ["Farah", "Tannous", "5550 2291", "5550 2292", "Ashcombe", "Tullamore", "2081 11021 1", "25.05.83", "Leila"],
    what: "a GP named without a title, a (dot)/(at) email and a street-corner location",
  },
  {
    id: "MSG-0986",
    kinds: ["name", "phone", "email", "address", "dob"],
    hide: ["Siobhan", "Kelly", "07700 900 733", "siobhankelly", "Seabright House", "41 Westway", "BN3 4FA", "BN3 5AE", "31.07.99", "Imogen"],
    what: "an ex-partner named after 'my ex', a square-bracket email and a street with no street type",
  },
];

const messageById = new Map(MESSAGES.map((m) => [m.id, m]));
const patientById = new Map(PATIENTS.map((p) => [p.id, p]));

function run(c: RedactCase) {
  const message = messageById.get(c.id);
  if (!message) throw new Error(`${c.id} is not in data/messages.json`);
  const patient = patientById.get(message.patientId);
  if (!patient) throw new Error(`${message.patientId} is not in data/patients.json`);
  const original = message.subject ? `${message.subject}\n\n${message.body}` : message.body;
  const names = conversationNames(message.thread, original, patient);
  return { original, ...redact(original, patient, { names }) };
}

describe("redaction: red-team cases", () => {
  it("every row points at a red-team message and quotes it word for word", () => {
    for (const c of CASES) {
      const { original } = run(c);
      expect(c.id >= "MSG-0923", c.id).toBe(true);
      for (const s of [...c.hide, ...(c.keep ?? [])]) expect(original, `${c.id} should contain "${s}"`).toContain(s);
    }
  });

  for (const c of CASES) {
    describe(`${c.id}: ${c.what}`, () => {
      for (const kind of c.kinds) {
        it(`hides a ${kind}`, () => {
          const { redactions } = run(c);
          expect(redactions.find((r) => r.type === kind)?.count ?? 0).toBeGreaterThan(0);
        });
      }
      for (const s of c.hide) {
        it(`hides "${s}"`, () => {
          expect(run(c).redactedText).not.toContain(s);
        });
      }
      for (const s of c.keep ?? []) {
        it(`keeps "${s}"`, () => {
          expect(run(c).redactedText).toContain(s);
        });
      }
    });
  }
});

/**
 * Round 4 red-team redaction cases, written as plain strings: each must show the placeholder and hide the listed pieces.
 * The guards are ordinary messages near the new patterns and must keep the words they list.
 */
const ROUND4: Record<string, { text: string; placeholder: string; hide: string[] }[]> = {
  "a card security code with words before it": [
    { text: "security code on the back is 987", placeholder: "[CARD]", hide: ["987"] },
    { text: "the security number on the back is 987", placeholder: "[CARD]", hide: ["987"] },
    { text: "card expiry 09/28, code 552", placeholder: "[CARD]", hide: ["09/28", "552"] },
    { text: "the 3 digits on the back are 456", placeholder: "[CARD]", hide: ["456"] },
  ],
  "veterans' and hospital record numbers": [
    { text: "DVA file number NX901667", placeholder: "[HEALTH ID]", hide: ["NX901667"] },
    { text: "DVA gold card NX901667", placeholder: "[HEALTH ID]", hide: ["NX901667"] },
    { text: "veterans file no. NX901667", placeholder: "[HEALTH ID]", hide: ["NX901667"] },
    { text: "MRN 00123456", placeholder: "[HEALTH ID]", hide: ["00123456"] },
    { text: "my medical record number is 00123456", placeholder: "[HEALTH ID]", hide: ["00123456"] },
    { text: "hospital UR number 1234567", placeholder: "[HEALTH ID]", hide: ["1234567"] },
    { text: "URN 1234567 at the Alfred", placeholder: "[HEALTH ID]", hide: ["1234567"] },
    { text: "hospital number RXH1234567", placeholder: "[HEALTH ID]", hide: ["RXH1234567"] },
    { text: "patient ID 7788991", placeholder: "[HEALTH ID]", hide: ["7788991"] },
  ],
  "health fund and concession card numbers": [
    { text: "health fund member no 12345678", placeholder: "[HEALTH ID]", hide: ["12345678"] },
    { text: "HCF membership 987654321", placeholder: "[HEALTH ID]", hide: ["987654321"] },
    { text: "private health: Bupa member 12345678", placeholder: "[HEALTH ID]", hide: ["12345678"] },
    { text: "my Bupa membership number is 12345678", placeholder: "[HEALTH ID]", hide: ["12345678"] },
    { text: "concession card 123-456-789A", placeholder: "[HEALTH ID]", hide: ["123-456-789A"] },
    { text: "Community Services Card 12345678", placeholder: "[HEALTH ID]", hide: ["12345678"] },
  ],
  "a birth date with no keyword": [
    { text: "14/03/1985", placeholder: "[DOB]", hide: ["14/03/1985"] },
    { text: "b. 14/03/1985", placeholder: "[DOB]", hide: ["14/03/1985"] },
    { text: "Jane Smith b. 14.03.1985", placeholder: "[DOB]", hide: ["14.03.1985"] },
    { text: "Jane, 3/4/1962, Fitzroy", placeholder: "[DOB]", hide: ["3/4/1962"] },
  ],
  "a lowercase suburb after the street": [
    { text: "my new place is 5 smith st south yarra", placeholder: "[ADDRESS]", hide: ["smith", "south yarra"] },
    { text: "my new place is 1/23 o'connell st north melbourne", placeholder: "[ADDRESS]", hide: ["connell", "north melbourne"] },
  ],
  "an email handle and social handles": [
    { text: "janedoe at gmail thanks", placeholder: "[EMAIL]", hide: ["janedoe"] },
    { text: "my ig is @jane.doe.88", placeholder: "[REDACTED]", hide: ["jane.doe.88"] },
    { text: "instagram @jane.doe.88", placeholder: "[REDACTED]", hide: ["jane.doe.88"] },
  ],
  "the name on a card, initials included": [
    { text: "exp 11/29, name on card B J Castellano.", placeholder: "[NAME]", hide: ["B J", "Castellano", "11/29"] },
    { text: "Name on card: JANE SMITH", placeholder: "[NAME]", hide: ["JANE", "SMITH"] },
  ],
  "an IBAN as one span": [
    { text: "IBAN GB82 WEST 1234 5698 7654 32", placeholder: "[REDACTED]", hide: ["GB82", "WEST", "5698"] },
    { text: "IBAN DE89 3704 0044 0532 0130 00", placeholder: "[REDACTED]", hide: ["DE89", "3704", "0130"] },
  ],
};

const ROUND4_GUARDS: [string, string[]][] = [
  ["the promo code 552 didn't work", ["552"]],
  ["tracking code 552 shows delivered", ["552"]],
  ["the security code didn't come through to 0412", ["didn't come through"]],
  ["delivered 14.03.2026", ["14.03.2026"]],
  ["my order from 03/09/2026 still hasn't come", ["03/09/2026"]],
  ["meet at home thanks", ["meet at home"]],
  ["I had problems at hotmail last week", ["problems"]],
  ["Your email @ the top was wrong", ["@ the top"]],
  ["see you @3pm", ["@3pm"]],
  ["5 smith st please, not 7", ["please"]],
  ["Order ORD-20481 arrived", ["ORD-20481"]],
  ["the ur number on the parcel is smudged", ["ur number on the parcel"]],
  ["the name on the card is wrong", ["the name on the card is wrong"]],
];

describe("redaction: round 4 red-team cases", () => {
  for (const [category, rows] of Object.entries(ROUND4)) {
    for (const row of rows) {
      it(`hides (${category}): ${row.text}`, () => {
        const out = redact(row.text).redactedText;
        expect(out).toContain(row.placeholder);
        for (const h of row.hide) expect(out, `leaked "${h}"`).not.toContain(h);
      });
    }
  }
  for (const [text, keep] of ROUND4_GUARDS) {
    it(`keeps ordinary wording: ${text}`, () => {
      const out = redact(text).redactedText;
      for (const k of keep) expect(out).toContain(k);
    });
  }
});
