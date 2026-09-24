import { describe, it, expect } from "vitest";
import { redact, redactionTotal } from "@/lib/pipeline/redact";
import type { Patient, PatientMessage, RedactionType } from "@/lib/types";
import messagesData from "@/data/messages.json";
import patientsData from "@/data/patients.json";

function patient(over: Partial<Patient> = {}): Patient {
  return {
    id: "PT-1001",
    firstName: "Jane",
    lastName: "O'Brien",
    email: "jane.obrien@example.com",
    phone: "0491 570 006",
    dob: "1985-03-12",
    address: { line1: "14 Banksia Drive", suburb: "Richmond", region: "VIC", postcode: "3121", country: "AU" },
    country: "AU",
    timezone: "Australia/Melbourne",
    plan: { name: "Monthly treatment plan", monthlyPrice: 129, currency: "AUD", status: "active", startedAt: "2026-03-03" },
    orders: [],
    charges: [],
    appointments: [],
    ...over,
  };
}

const count = (r: ReturnType<typeof redact>, t: RedactionType) => r.redactions.find((x) => x.type === t)?.count ?? 0;

describe("redact: names", () => {
  it("replaces the patient's full name as one placeholder", () => {
    const r = redact("Hi, this is Jane O'Brien, where is my order?", patient());
    expect(r.redactedText).toBe("Hi, this is [NAME], where is my order?");
    expect(count(r, "name")).toBe(1);
  });

  it("matches first and last names case-insensitively and keeps possessives", () => {
    const r = redact("jane's order and JANE again, from the o'brien family", patient());
    expect(r.redactedText).toBe("[NAME]'s order and [NAME] again, from the [NAME] family");
  });

  it("handles a curly apostrophe in the surname", () => {
    const r = redact("Regards, Jane O’Brien", patient());
    expect(r.redactedText).not.toMatch(/Jane|Brien/);
  });

  it("respects word boundaries (Jane is not redacted inside Janet or Janeway)", () => {
    const r = redact("Janet from Janeway St", patient({ lastName: "Nguyen" }));
    expect(r.redactedText).toContain("Janet");
    expect(r.redactedText).toContain("Janeway");
  });

  it("redacts a common-word first name only when capitalised", () => {
    const p = patient({ firstName: "Will", lastName: "Harper" });
    const r = redact("I will call tomorrow. Thanks, Will", p);
    expect(r.redactedText).toBe("I will call tomorrow. Thanks, [NAME]");
  });

  it("catches 'my name is' and repeats of that name", () => {
    const r = redact("My name is Priya Raman. Priya is on the account.");
    expect(r.redactedText).toBe("My name is [NAME]. [NAME] is on the account.");
  });

  it("catches sign-offs on the same line and on the next line", () => {
    expect(redact("Where is it? Thanks, Sarah").redactedText).toBe("Where is it? Thanks, [NAME]");
    expect(redact("Where is it?\n\nCheers,\nTom Baker").redactedText).toBe("Where is it?\n\nCheers,\n[NAME]");
    expect(redact("Kind regards\nAroha").redactedText).toBe("Kind regards\n[NAME]");
    expect(redact("Ta, Mel x").redactedText).toBe("Ta, [NAME] x");
  });

  it("does not treat ordinary words after a sign-off as a name", () => {
    expect(redact("Thanks for your help").redactedText).toBe("Thanks for your help");
    expect(redact("Cheers, Team").redactedText).toBe("Cheers, Team");
    expect(redact("Thanks in advance.").redactedText).toBe("Thanks in advance.");
  });

  it("redacts names given by a carer for a relative", () => {
    const r = redact("I'm writing about my mum Margaret Ellis. Margaret passed away on Sunday.");
    expect(r.redactedText).toBe("I'm writing about my mum [NAME]. [NAME] passed away on Sunday.");
  });

  it("redacts names after a title but keeps the title", () => {
    expect(redact("Dr Hana Whitlock said I could renew").redactedText).toBe("Dr [NAME] said I could renew");
  });

  it("counts every name occurrence", () => {
    const r = redact("Jane here. Jane again. Thanks, Jane", patient());
    expect(count(r, "name")).toBe(3);
  });
});

describe("redact: contact details", () => {
  it("redacts email addresses, even ones containing the patient's name", () => {
    const r = redact("Email me at jane.obrien+care@example.org please", patient());
    expect(r.redactedText).toBe("Email me at [EMAIL] please");
    expect(count(r, "email")).toBe(1);
    expect(count(r, "name")).toBe(0);
  });

  const phones: [string, string][] = [
    ["AU mobile", "0491 570 006"],
    ["AU mobile, no spaces", "0491570006"],
    ["AU mobile, international", "+61 491 570 006"],
    ["AU mobile, international no space", "+61491570006"],
    ["AU landline with brackets", "(03) 5550 4567"],
    ["AU landline", "02 5550 4321"],
    ["AU 1300", "1300 975 707"],
    ["AU 1800", "1800 160 401"],
    ["NZ mobile", "021 555 0123"],
    ["NZ mobile international", "+64 21 555 0124"],
    ["NZ landline", "(09) 555 0125"],
    ["NZ 0800", "0800 555 012"],
    ["UK mobile", "07700 900123"],
    ["UK mobile international", "+44 7700 900123"],
    ["UK London with (0)", "+44 (0)20 7946 0958"],
    ["UK London", "020 7946 0958"],
    ["UK geographic", "01632 960123"],
    ["with dashes", "0491-570-006"],
  ];
  for (const [label, number] of phones) {
    it(`redacts phone numbers: ${label}`, () => {
      const r = redact(`Call me on ${number} after 3pm.`);
      expect(r.redactedText).toBe("Call me on [PHONE] after 3pm.");
    });
  }
});

describe("redact: addresses", () => {
  it("redacts a street address with suburb, state and postcode", () => {
    const r = redact("Please send it to 22 King St, Carlton VIC 3053 instead.");
    expect(r.redactedText).toBe("Please send it to [ADDRESS] instead.");
  });

  it("redacts unit forms", () => {
    expect(redact("Unit 4, 22 King Street").redactedText).toBe("[ADDRESS]");
    expect(redact("I'm at 4/22 King Street now").redactedText).toBe("I'm at [ADDRESS] now");
    expect(redact("Flat 2, 10 Baker Road, London NW1 6XE").redactedText).toBe("[ADDRESS]");
  });

  it("redacts lower-case unambiguous street types", () => {
    expect(redact("new address is 7 smith rd").redactedText).toBe("new address is [ADDRESS]");
  });

  it("redacts the patient's own address from the record", () => {
    const r = redact("Is it going to 14 banksia drive, Richmond VIC 3121?", patient());
    expect(r.redactedText).toBe("Is it going to [ADDRESS]?");
  });

  it("redacts PO boxes and UK postcodes", () => {
    expect(redact("PO Box 123 please").redactedText).toBe("[ADDRESS] please");
    expect(redact("postcode SW1A 1AA").redactedText).toBe("postcode [ADDRESS]");
  });

  it("does not read time frames as addresses", () => {
    const text = "I've been waiting 3 days on the way home, and 2 weeks at the Court of Appeal.";
    expect(redact(text).redactedText).toBe(text);
    expect(redact("I ordered 2 more last week").redactedText).toBe("I ordered 2 more last week");
  });
});

describe("redact: dates of birth", () => {
  it("redacts a date after DOB or born, but not other dates", () => {
    const r = redact("My DOB is 12/03/1985 and my order from 18/09/2026 is late.");
    expect(r.redactedText).toBe("My DOB is [DOB] and my order from 18/09/2026 is late.");
    expect(count(r, "dob")).toBe(1);
  });

  it("handles written dates and several keywords", () => {
    expect(redact("I was born on 12 March 1985.").redactedText).toBe("I was born on [DOB].");
    expect(redact("Date of birth: March 12, 1985").redactedText).toBe("Date of birth: [DOB]");
    expect(redact("birthday is 3rd of June 1990").redactedText).toBe("birthday is [DOB]");
    expect(redact("d.o.b. 1985-03-12").redactedText).toBe("d.o.b. [DOB]");
    expect(redact("12/03/85 (DOB) for the account").redactedText).toBe("[DOB] (DOB) for the account");
  });

  it("redacts a bare birth year after born", () => {
    expect(redact("I was born in 1962 so I get concession").redactedText).toBe("I was born in [DOB] so I get concession");
  });

  it("redacts the patient's DOB from the record wherever it appears", () => {
    expect(redact("For ID it's 12/03/1985", patient()).redactedText).toBe("For ID it's [DOB]");
  });

  it("leaves delivery dates alone", () => {
    const text = "It was due on 22 September and it's now 23/09/2026.";
    expect(redact(text).redactedText).toBe(text);
  });
});

describe("redact: health identifiers and cards", () => {
  it("redacts Medicare-like numbers", () => {
    expect(redact("Medicare 2123 45670 1").redactedText).toBe("Medicare [HEALTH ID]");
    expect(redact("my card number is 21234567801").redactedText).toBe("my card number is [HEALTH ID]");
  });

  it("redacts NHS-like and NHI-like numbers", () => {
    expect(redact("NHS number 485 777 3456").redactedText).toBe("NHS number [HEALTH ID]");
    expect(redact("NHI ZAC5361 and new format ZAA00AC").redactedText).toBe("NHI [HEALTH ID] and new format [HEALTH ID]");
    expect(redact("my nhi is zzz0016").redactedText).toBe("my nhi is [HEALTH ID]");
  });

  it("redacts card numbers of 13 to 19 digits", () => {
    const r = redact("Charge 4111 1111 1111 1111 or 5500-0000-0000-0004 or 378282246310005");
    expect(r.redactedText).toBe("Charge [CARD] or [CARD] or [CARD]");
    expect(count(r, "card")).toBe(3);
  });
});

describe("redact: protected values are never touched", () => {
  it("keeps order ids, tracking numbers and amounts", () => {
    const text = "Order ORD-20481, tracking CD4829103756, cost $129.00 (AUD 129.00), NZ$89 and £49.99, refund 40 dollars.";
    const r = redact(text, patient());
    expect(r.redactedText).toBe(text);
    expect(r.redactions).toEqual([]);
  });

  it("keeps our other record ids", () => {
    const text = "Re CHG-30012 and APT-40012 for PT-1001";
    expect(redact(text).redactedText).toBe(text);
  });
});

describe("redact: whole messages", () => {
  it("returns counts per type in a stable order", () => {
    const r = redact(
      "Hi, Jane O'Brien here (DOB 12/03/1985). Call 0491 570 006 or email jane@example.com. " +
        "New address: 22 King St, Carlton VIC 3053. Medicare 2123 45670 1. Thanks, Jane",
      patient(),
    );
    expect(r.redactions.map((x) => x.type)).toEqual(["name", "email", "phone", "address", "dob", "health_id"]);
    expect(count(r, "name")).toBe(2);
    expect(r.redactions.find((x) => x.type === "health_id")?.placeholder).toBe("[HEALTH ID]");
    expect(redactionTotal(r.redactions)).toBe(7);
    expect(r.redactedText).not.toMatch(/Jane|0491|example|King|2123|1985/);
  });

  it("leaves a message with no personal details unchanged", () => {
    const text = "Where is my order? It was meant to arrive Tuesday.";
    expect(redact(text)).toEqual({ redactedText: text, redactions: [] });
  });

  it("handles empty text", () => {
    expect(redact("")).toEqual({ redactedText: "", redactions: [] });
  });
});

// A fictional NZ patient whose record address uses te reo Māori and a comma in the suburb field.
const nzPatient = () =>
  patient({
    id: "PT-1042",
    firstName: "Mele",
    lastName: "Taufa",
    phone: "021 555 0142",
    dob: "1972-07-19",
    country: "NZ",
    timezone: "Pacific/Auckland",
    address: { line1: "4 Marine Parade East", suburb: "Mount Maunganui, Tauranga", region: "Bay of Plenty", postcode: "3116", country: "NZ" },
  });

describe("redact: addresses with macrons and accents", () => {
  it("redacts a new NZ address written over three lines (MSG-0120)", () => {
    const text =
      "Could you please change my delivery address to my own flat from now on:\n\nFlat 3, 18 Kōtuku Lane\nMount Maunganui\nTauranga 3116\n\nI'm working from home more these days.";
    const r = redact(text, nzPatient());
    expect(r.redactedText).toBe(
      "Could you please change my delivery address to my own flat from now on:\n\n[ADDRESS]\n\nI'm working from home more these days.",
    );
    // Without the patient record too: the pattern, not the record, does the work.
    expect(redact(text).redactedText).not.toMatch(/Kōtuku|Maunganui|Tauranga|3116/);
  });

  it("redacts the same address on one line, with or without commas", () => {
    expect(redact("Flat 3, 18 Kōtuku Lane Mount Maunganui Tauranga 3116").redactedText).toBe("[ADDRESS]");
    expect(redact("Flat 3, 18 Kōtuku Lane, Mount Maunganui, Tauranga 3116").redactedText).toBe("[ADDRESS]");
  });

  it("redacts street names with macrons or accents", () => {
    for (const a of ["14 Kōwhai Terrace", "3 Tōtara Street", "5 Māui Street", "12 Renée Street", "12 Te Ōtākou Road"]) {
      expect(redact(`Please send it to ${a} from now on`).redactedText).toBe("Please send it to [ADDRESS] from now on");
    }
  });

  it("takes the suburb and postcode along with the street", () => {
    expect(redact("12 Te Awa Road, Ōtaki").redactedText).toBe("[ADDRESS]");
    expect(redact("42 Riverside Dr, Ōtaki 5512").redactedText).toBe("[ADDRESS]");
  });

  it("matches a record suburb written without its comma", () => {
    const r = redact("It should go to 4 Marine Parade East Mount Maunganui Tauranga 3116", nzPatient());
    expect(r.redactedText).toBe("It should go to [ADDRESS]");
  });

  it("stops the address at a blank line or a sign-off", () => {
    expect(redact("22 King St, Carlton VIC 3053\nThanks, Tom").redactedText).toBe("[ADDRESS]\nThanks, [NAME]");
    expect(redact("18 Kōtuku Lane\n\nMele").redactedText).toBe("[ADDRESS]\n\n[NAME]");
  });
});

describe("redact: postcodes given on their own", () => {
  it("redacts the record postcode given for an identity check (MSG-0022)", () => {
    const p = patient({ address: { line1: "7 Old Mill Lane", suburb: "Bendigo", region: "VIC", postcode: "3550", country: "AU" } });
    const r = redact("In case you need to check it's me: DOB 04/04/1997, postcode 3550, and my last order was ORD-20058.", p);
    expect(r.redactedText).toBe("In case you need to check it's me: DOB [DOB], postcode [ADDRESS], and my last order was ORD-20058.");
    // The record postcode is caught without the keyword as well.
    expect(redact("Still at 3550 for delivery", p).redactedText).toBe("Still at [ADDRESS] for delivery");
  });

  it("redacts any 4-digit postcode after a postcode keyword (MSG-0039)", () => {
    expect(redact("dob is 06/05/2003 and postcode is 9016 if that helps").redactedText).toBe(
      "dob is [DOB] and postcode is [ADDRESS] if that helps",
    );
    expect(redact("post code: 2026").redactedText).toBe("post code: [ADDRESS]");
    expect(redact("my postal code 6011").redactedText).toBe("my postal code [ADDRESS]");
  });

  it("does not redact a year that happens to equal the record postcode", () => {
    const p = patient({ address: { line1: "5/88 Coolibah Street", suburb: "Bondi", region: "NSW", postcode: "2026", country: "AU" } });
    expect(redact("It was due on 22 September 2026.", p).redactedText).toBe("It was due on 22 September 2026.");
    expect(redact("my postcode is 2026", p).redactedText).toBe("my postcode is [ADDRESS]");
  });

  it("keeps amounts, order ids and other numbers", () => {
    const p = patient({ address: { line1: "7 Old Mill Lane", suburb: "Bendigo", region: "VIC", postcode: "3550", country: "AU" } });
    expect(redact("Charged $3550 on ORD-3550? Tracking CD3550355035", p).redactedText).toBe("Charged $3550 on ORD-3550? Tracking CD3550355035");
  });

  it("redacts a state and postcode on their own", () => {
    expect(redact("I'm now in VIC 3053").redactedText).toBe("I'm now in [ADDRESS]");
  });
});

describe("redact: names outside the patient record", () => {
  it("redacts a signature name on its own line, with a title line under it", () => {
    expect(redact("Where is my order?\n\nSam Porter\nCFO").redactedText).toBe("Where is my order?\n\n[NAME]\nCFO");
    expect(redact("Any update on ORD-20481?\n\nPriya Raman").redactedText).toBe("Any update on ORD-20481?\n\n[NAME]");
  });

  it("does not read a one-line message or a closing word as a signature", () => {
    expect(redact("Order Status").redactedText).toBe("Order Status");
    expect(redact("Where is it?\n\nThanks").redactedText).toBe("Where is it?\n\nThanks");
    expect(redact("Where is it?\n\nURGENT").redactedText).toBe("Where is it?\n\nURGENT");
  });

  it("redacts a self-introduction in any case, and its repeats", () => {
    expect(redact("hi this is tom smith, where is my order\ntom").redactedText).toBe("hi this is [NAME], where is my order\n[NAME]");
    expect(redact("Hi there,\n\nI'm Karen, Georgia's daughter.").redactedText).toBe("Hi there,\n\nI'm [NAME], Georgia's daughter.");
    expect(redact("hey im jo. my order is late").redactedText).toBe("hey im [NAME]. my order is late");
  });

  it("leaves everyday words after I'm and this is alone", () => {
    const text = "I'm sorry. I'm there until Thursday. this is urgent. It's cancelled, it's worst mid-morning and I'm in Papatoetoe, ok.";
    expect(redact(text).redactedText).toBe(text);
  });

  it("redacts te reo Māori and accented names", () => {
    expect(redact("Kia ora, Āwhina here. Ngā mihi, Āwhina").redactedText).toBe("Kia ora, [NAME] here. Ngā mihi, [NAME]");
    expect(redact("My name is Zoë Ngāti").redactedText).toBe("My name is [NAME]");
  });

  it("does not take a greeting on the next line as a name after 'call me'", () => {
    expect(redact("Please call me\n\nMālō e lelei,\n\nMy number is below.").redactedText).toBe(
      "Please call me\n\nMālō e lelei,\n\nMy number is below.",
    );
  });
});

describe("redact: other small gaps", () => {
  it("redacts a two-digit birth year after a written date", () => {
    expect(redact("dob 3rd of March 85").redactedText).toBe("dob [DOB]");
    expect(redact("born March 3, '85").redactedText).toBe("born [DOB]");
  });

  it("redacts spelled-out emails", () => {
    expect(redact("email jo dot smith at gmail dot com thanks").redactedText).toBe("email [EMAIL] thanks");
    expect(redact("reach me on jo.smith (at) example.org").redactedText).toBe("reach me on [EMAIL]");
  });
});

describe("redact: review round 3, possessives and the patient's own record values", () => {
  it("redacts a possessive name written without the apostrophe", () => {
    const tom = patient({ firstName: "Tom", lastName: "Fitzgerald" });
    expect(redact("hey its bec, toms partner. hes been in icu", tom).redactedText).toBe("hey its bec, [NAME] partner. hes been in icu");
    const priya = patient({ firstName: "Priya", lastName: "Raman" });
    expect(redact("its priyas account, not mine", priya).redactedText).toBe("its [NAME] account, not mine");
    // With the apostrophe the "'s" stays after the placeholder.
    expect(redact("It's Priya's account", priya).redactedText).toBe("It's [NAME]'s account");
  });

  it("keeps common-word and short names exact, so plurals of everyday words survive", () => {
    const will = patient({ firstName: "Will", lastName: "Page" });
    expect(redact("the wills and pages are fine", will).redactedText).toBe("the wills and pages are fine");
  });

  it("redacts the patient's NHI in any case, with or without a keyword", () => {
    const aroha = patient({ firstName: "Aroha", lastName: "Mitchell", country: "NZ", identifiers: { nhi: "ZEY0888" } });
    expect(redact("hi its me, id zey0888", aroha).redactedText).toBe("hi its me, id [HEALTH ID]");
    expect(redact("ref zey 0888 thanks", aroha).redactedText).toBe("ref [HEALTH ID] thanks");
    // Any NHI-shaped token in lower case, even when it is not the patient's own.
    expect(redact("my other number is abc1234").redactedText).toBe("my other number is [HEALTH ID]");
  });

  it("redacts the patient's Medicare number however it is spaced", () => {
    const p = patient({ identifiers: { medicare: "2921 34056 1" } });
    for (const written of ["2921340561", "2921-34056-1", "2921 34056 1/2", "29213 40561"]) {
      expect(redact(`my card is ${written} ok`, p).redactedText, written).toBe("my card is [HEALTH ID] ok");
    }
  });

  it("redacts the patient's email and phone from the record, in any case or spacing", () => {
    const p = patient();
    expect(redact("reach me on JANE.OBRIEN@EXAMPLE.COM", p).redactedText).toBe("reach me on [EMAIL]");
    expect(redact("call 0491570006 or +61 491 570 006", p).redactedText).toBe("call [PHONE] or [PHONE]");
    expect(redact("my number is 0491.570.006", p).redactedText).toBe("my number is [PHONE]");
  });
});

describe("redact: where the patient lives and works (review round 2)", () => {
  const MESSAGES = messagesData as unknown as PatientMessage[];
  const PATIENTS = patientsData as unknown as Patient[];
  const real = (id: string) => {
    const m = MESSAGES.find((x) => x.id === id)!;
    const p = PATIENTS.find((x) => x.id === m.patientId)!;
    return redact(`${m.subject ?? ""}\n\n${m.body}`, p).redactedText;
  };

  it("MSG-0010: a sign-off line of a town and a state code is an address", () => {
    const text = real("MSG-0010");
    expect(text).not.toMatch(/Albany/);
    expect(text).toMatch(/\[NAME\]\n\[ADDRESS\]$/);
  });

  it("MSG-0142: the patient's own town is hidden wherever it appears", () => {
    const text = real("MSG-0142");
    expect(text).not.toMatch(/Ballarat/);
    expect(text).toContain("nothing's turned up here in [ADDRESS]");
  });

  it("MSG-0159: both the old and the new suburb are hidden, also in running text", () => {
    const text = real("MSG-0159");
    expect(text).not.toMatch(/Marrickville|Petersham/);
    expect(text).toContain("from [ADDRESS] to [ADDRESS]");
    expect(text).toContain("everything goes to [ADDRESS] from now on");
  });

  it("MSG-0177: a workplace named just before an address goes with it", () => {
    const text = real("MSG-0177");
    expect(text).not.toMatch(/Harbourside|Studios|Cardiff/);
    expect(text).toContain("Reception can sign for it.\n\n[ADDRESS]\n");
  });

  it("keeps everyday words that are also place names", () => {
    const p = patient({ address: { line1: "3 Hill Road", suburb: "Mount Hope", region: "NSW", postcode: "2877", country: "AU" } });
    expect(redact("I hope it comes soon, it is up the hill from the park", p).redactedText).toBe(
      "I hope it comes soon, it is up the hill from the park",
    );
  });
});

describe("redact: disguised details (red-team round 1)", () => {
  const hides = (text: string, piece: string, type: RedactionType) => {
    const r = redact(text);
    expect(r.redactedText, text).not.toContain(piece);
    expect(count(r, type), text).toBeGreaterThan(0);
  };

  it("hides a card with double spaces, its expiry and its security code", () => {
    const r = redact("new card\n4000  0566  5566  5556\nexp 10/29\ncvv 318\nthanks");
    expect(r.redactedText).toBe("new card\n[CARD]\nexp [CARD]\ncvv [CARD]\nthanks");
  });

  it("hides an expiry written after a card number", () => {
    hides("It's 4622 9031 5578 1106, exp 11/29, name on card B J C.", "11/29", "card");
    hides("The security code is 123 on the back.", "123", "card");
  });

  it("hides emails spelled out with brackets or words", () => {
    for (const email of [
      "farah(dot)tannous(at)example(dot)com(dot)au",
      "kaimoana.fan94 [at] example [dot] co [dot] nz",
      "siobhankelly [at] example [dot] com",
      "jo {at} example {dot} net",
    ]) {
      const r = redact(`Her email is ${email} if you need it.`);
      expect(r.redactedText, email).toBe("Her email is [EMAIL] if you need it.");
    }
  });

  it("hides phones with the prefix in brackets, a 00 exit code, a bare country code or no area code", () => {
    hides("The new one is (0491) 573 087.", "573 087", "phone");
    hides("Work phone: 0044 7700 900519", "900519", "phone");
    hides("Her mobile is 64 27 555 0199.", "555 0199", "phone");
    hides("try the landline at home, 5550 3172 (no area code).", "5550 3172", "phone");
  });

  it("keeps a public crisis line and ordinary numbers", () => {
    expect(redact("I rang Lifeline on 13 11 14 last night.").redactedText).toBe("I rang Lifeline on 13 11 14 last night.");
    expect(redact("Order ORD-20020 had 2 bottles for $148.00.").redactedText).toBe("Order ORD-20020 had 2 bottles for $148.00.");
  });

  it("hides a Centrelink CRN, a CHI number and a National Insurance number", () => {
    hides("CRN 204 118 395K", "395K", "health_id");
    hides("It's 240974 1826, in case you need it.", "240974 1826", "health_id");
    hides("my National Insurance number is QQ 12 34 56 C.", "QQ 12 34 56 C", "other");
  });

  it("hides dates of birth with a hyphenated month, in words, or given as an age", () => {
    hides("dob 03-Oct-81 if u need to check", "03-Oct-81", "dob");
    hides("my date of birth is the twenty-sixth of March, nineteen fifty-two, and", "nineteen fifty-two", "dob");
    hides("she would have turned 75 on the 16th of Feb, and", "16th of Feb", "dob");
  });

  it("does not read a card's validity date as a birth date when the DOB keyword belongs to the next date", () => {
    const r = redact("valid from 18/09/2026\n\ndob 03-Oct-81 if you need it");
    expect(r.redactedText).toBe("valid from 18/09/2026\n\ndob [DOB] if you need it");
  });

  it("hides a street named in a sentence, a street corner and the parts before an address", () => {
    hides("I'm staying at her place, number 8 on Saltwater Lane, until then.", "Saltwater Lane", "address");
    hides("The practice is on the corner of Ashcombe and Tullamore Streets.", "Tullamore", "address");
    const r = redact("I'm now at Flat 3, Seabright House, 41 Westway, Hove BN3 4FA. Thanks");
    expect(r.redactedText).toBe("I'm now at [ADDRESS], [ADDRESS], [ADDRESS], [ADDRESS]. Thanks");
  });

  it("keeps a highway named with 'the' and a public place in running text", () => {
    expect(redact("Don't want to be dopey on the Desert Road.").redactedText).toBe("Don't want to be dopey on the Desert Road.");
  });

  it("hides house-name lines above a postcode, but not a name above a numbered street line", () => {
    expect(redact("It's just the house name:\nTaigh na Faoileig\nArdcorrach\nIsle of Skye\nIV49 9ZX\n\nThanks").redactedText).toBe(
      "It's just the house name:\n[ADDRESS]\n[ADDRESS]\n[ADDRESS]\n[ADDRESS]\n\nThanks",
    );
    const text = "Please send it to:\n\nAnjali Singh\n27 Kahikatea Drive\nRiccarton, Christchurch 8011\n\nThanks";
    expect(redact(text).redactedText).toContain("Anjali Singh\n[ADDRESS]\n[ADDRESS]\n\nThanks");
    const known = patient({ firstName: "Anjali", lastName: "Singh" });
    expect(redact(text, known).redactedText).toContain("[NAME]\n[ADDRESS]\n[ADDRESS]\n\nThanks");
  });

  it("hides people named without a relation word: after a pronoun, next door, on a letterbox, an ex or a GP", () => {
    hides("She is Caroline Hollis, and her email is below.", "Caroline", "name");
    hides("If nobody picks up, Brenda next door takes messages.", "Brenda", "name");
    hides("The letterbox on the road says J & R Tamihana, but the house is up the drive.", "Tamihana", "name");
    hides("My ex, Siobhan Kelly, used to ring up for me.", "Siobhan", "name");
    hides("My GP, Farah Tannous, has asked me to check.", "Tannous", "name");
    hides("Can you add my partner kirra as someone who can talk to you?", "kirra", "name");
  });

  it("keeps everyday words after a pronoun or a relation word", () => {
    expect(redact("She is Happy with the new box.").redactedText).toBe("She is Happy with the new box.");
    expect(redact("My GP is lovely and my partner as well.").redactedText).toBe("My GP is lovely and my partner as well.");
    expect(redact("He went to A & E last night.").redactedText).toBe("He went to A & E last night.");
  });
});

describe("redact: red-team round 2, disguised details", () => {
  const cases: [string, string][] = [
    ["Call me on oh four one two, three four five, six seven eight.", "Call me on [PHONE]."],
    ["My mobile is zero four one two three four five six seven eight.", "My mobile is [PHONE]."],
    ["Ring +61 (4) 1234 5678 any time.", "Ring [PHONE] any time."],
    ["Call 0412/345/678.", "Call [PHONE]."],
    ["My email is janesmith1984 at gmail.", "My email is [EMAIL]."],
    ['Reach me at "jsmith" at outlook.', "Reach me at [EMAIL]."],
    ["Email jane.smith @ gmail . com thanks.", "Email [EMAIL] thanks."],
    ["Email jane.smith@gmail,com thanks.", "Email [EMAIL] thanks."],
    ["Email jane.smith＠gmail.com thanks.", "Email [EMAIL] thanks."],
    ["My card is 2 1 2 3 4 5 6 7 0 1 on the front.", "My card is [HEALTH ID] on the front."],
    ["Medicare 2 1 2 3 4 5 6 7 0 1.", "Medicare [HEALTH ID]."],
    ["NHS no 943.476.5919.", "NHS no [HEALTH ID]."],
    ["NHI ZZZ 0016 is mine.", "NHI [HEALTH ID] is mine."],
    ["NHI is ZZZ-0016.", "NHI is [HEALTH ID]."],
    ["Card 4111.1111.1111.1111 exp 12/28.", "Card [CARD] exp [CARD]."],
    ["Card 4111/1111/1111/1111.", "Card [CARD]."],
    ["DOB: 1985/03/03.", "DOB: [DOB]."],
    ["DOB 19850303.", "DOB [DOB]."],
    ["Date of birth: March 1985.", "Date of birth: [DOB]."],
    ["Born March '85, so I'm 41.", "Born [DOB], so I'm 41."],
    ["I was born on 03/03.", "I was born on [DOB]."],
    ["Deliver to 14 banksia drive, Mornington.", "Deliver to [ADDRESS]."],
    ["Address is 14 Banksia Drv Mornington.", "Address is [ADDRESS]."],
    ["Address is 22 Kowhai Heights, Hamilton.", "Address is [ADDRESS]."],
    ["Postcode sw1a 1aa.", "Postcode [ADDRESS]."],
    ["Send it to 1442 RD 2, Te Awamutu 3872.", "Send it to [ADDRESS]."],
    ["Send it to 55 Paterangi Road, RD 2, Te Awamutu.", "Send it to [ADDRESS]."],
    ["Kia ora, Wiremu here about my order.", "Kia ora, [NAME] here about my order."],
    ["Hi team, it's Marguerite again.", "Hi team, it's [NAME] again."],
    ["IRD 123-456-789.", "IRD [REDACTED]."],
    ["ni qq 12 34 56 c", "ni [REDACTED]"],
  ];
  for (const [text, want] of cases) {
    it(`hides: ${text}`, () => {
      expect(redact(text).redactedText).toBe(want);
    });
  }

  const ordinary = [
    "I'll be at work. Me too, thanks.",
    "Order ORD-20481 was due 22/09 and cost $129.00.",
    "I take 2.5 ml at night.",
    "The 2026 plan went up in March 2026.",
    "Everyone here loves you guys.",
    "Mum here, writing for my son.",
    "My friend works at outlook and says hi.",
    "It is 3 or 4 days late, one or two items missing.",
    "I have one two three four questions.",
    "Hi, it's me again.",
    "The price rose from $148 to $158 on 1/9.",
  ];
  for (const text of ordinary) {
    it(`keeps: ${text}`, () => {
      expect(redact(text).redactedText).toBe(text);
    });
  }
});
