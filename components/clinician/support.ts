/**
 * Which support lines the clinician sees, and how they are framed. Pure helpers, no React.
 *
 *  supportMode   what the card is for: crisis language, urgent medical help (a possible serious reaction, a child who
 *                swallowed a product, taking more than prescribed), a family after a possible death, or a living
 *                patient who has lost someone. Each gets its own lines in its own order.
 *  ukNation      the UK nation the patient's address is in, so only that nation's regional line is shown.
 *  selectLines   the lines to show first and the ones folded away. Numbers come only from data/helplines.json.
 *
 * Every patient is fictional demo material.
 */
import type { Country, PipelineResult, RuleHit } from "@/lib/types";
import type { Helpline, HelplineKind } from "@/lib/client/types";
import type { DeskRow } from "@/lib/client/queue";
import type { DeathFraming } from "./model";

/**
 * crisis    crisis language: the emergency number first, then the crisis line.
 * medical   a possible serious reaction or poisoning: the emergency number and the poisons line, as urgent medical help.
 * family    the patient may have died: a note for the family, with the lines one click away.
 * grief     a living patient has lost someone and nothing else is urgent: a note for them, lines one click away.
 */
export type SupportMode = "crisis" | "medical" | "family" | "grief";

function crisisSignal(row: DeskRow, result: PipelineResult, death: DeathFraming): boolean {
  if ((row.reason.category ?? row.category) === "crisis") return true;
  if (result.sort?.category === "crisis") return true;
  if (death.others.includes("crisis")) return true;
  return result.rules.hits.some((h: RuleHit) => h.category === "crisis");
}

/** What the support card is for on this item, or null when it shows none (an item that is not urgent). */
export function supportMode(row: DeskRow, result: PipelineResult, death: DeathFraming): SupportMode | null {
  if (row.escalatedByAgent) return null;
  if (death.led) return "family";
  if (death.mentioned && death.others.length === 0) return "grief";
  if (row.status !== "urgent") return null;
  return crisisSignal(row, result, death) ? "crisis" : "medical";
}

// ---------- UK nations ----------

export type UkNation = "England" | "Scotland" | "Wales" | "Northern Ireland";

/** Postcode areas that sit wholly in one nation. Areas that cross a border (TD, CH, SY) are left to the place names. */
const POSTCODE_NATION: Record<string, UkNation> = {
  BT: "Northern Ireland",
  AB: "Scotland",
  DD: "Scotland",
  DG: "Scotland",
  EH: "Scotland",
  FK: "Scotland",
  G: "Scotland",
  HS: "Scotland",
  IV: "Scotland",
  KA: "Scotland",
  KW: "Scotland",
  KY: "Scotland",
  ML: "Scotland",
  PA: "Scotland",
  PH: "Scotland",
  ZE: "Scotland",
  CF: "Wales",
  SA: "Wales",
  NP: "Wales",
  LL: "Wales",
  LD: "Wales",
};

const PLACES: [UkNation, string[]][] = [
  [
    "Scotland",
    [
      "scotland", "glasgow", "edinburgh", "aberdeen", "aberdeenshire", "dundee", "inverness", "stirling", "perth and kinross",
      "fife", "lothian", "highland", "highlands", "lanarkshire", "renfrewshire", "ayrshire", "dunbartonshire", "argyll",
      "scottish borders", "dumfries", "galloway", "moray", "angus", "orkney", "shetland", "falkirk", "clackmannanshire",
      "inverclyde", "eilean siar", "western isles", "paisley", "livingston", "kilmarnock",
    ],
  ],
  [
    "Wales",
    [
      "wales", "cardiff", "swansea", "wrexham", "gwynedd", "powys", "ceredigion", "pembrokeshire", "carmarthenshire", "conwy",
      "denbighshire", "flintshire", "anglesey", "ynys mon", "glamorgan", "bridgend", "rhondda", "caerphilly", "merthyr tydfil",
      "torfaen", "monmouthshire", "blaenau gwent", "neath", "port talbot", "aberystwyth",
    ],
  ],
  [
    "Northern Ireland",
    [
      "northern ireland", "belfast", "antrim", "armagh", "county down", "fermanagh", "londonderry", "derry", "tyrone",
      "lisburn", "newry", "mid ulster", "causeway coast",
    ],
  ],
];
/** Names shared with a place in another nation (Newport, Isle of Wight; Bangor, County Down): trusted only as the region. */
const REGION_ONLY: [UkNation, string[]][] = [["Wales", ["newport"]]];

function placeNation(text: string, table: [UkNation, string[]][]): UkNation | null {
  const plain = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const t = ` ${plain.replace(/[^a-z]+/g, " ").trim()} `;
  for (const [nation, names] of table) if (names.some((n) => t.includes(` ${n} `))) return nation;
  return null;
}

/**
 * The UK nation a patient lives in, from the postcode when there is one, else the region, else the suburb or town.
 * Any other UK address is in England. Null outside the UK, or when the address says nothing at all.
 */
export function ukNation(patient: { country: Country; region?: string; suburb?: string; postcode?: string }): UkNation | null {
  if (patient.country !== "UK") return null;
  const area = /^\s*([A-Za-z]{1,2})\d/.exec(patient.postcode ?? "")?.[1]?.toUpperCase();
  if (area && POSTCODE_NATION[area]) return POSTCODE_NATION[area];
  const region = patient.region?.trim() ?? "";
  const suburb = patient.suburb?.trim() ?? "";
  const byRegion = region && (placeNation(region, PLACES) ?? placeNation(region, REGION_ONLY));
  if (byRegion) return byRegion;
  const bySuburb = suburb && placeNation(suburb, PLACES);
  if (bySuburb) return bySuburb;
  return region || suburb || area ? "England" : null;
}

// ---------- Choosing the lines ----------

/** The kinds shown first for each mode, in order. Everything else for the country is folded away. */
const PRIMARY: Record<SupportMode, HelplineKind[]> = {
  crisis: ["emergency", "crisis", "poisons", "health_advice"],
  medical: ["emergency", "poisons", "health_advice"],
  family: ["crisis", "health_advice", "emergency"],
  grief: ["crisis", "health_advice", "emergency"],
};

export interface SupportLines {
  /** The lines for this case, in the order to give them. */
  primary: Helpline[];
  /** The country's other lines, folded away. */
  other: Helpline[];
}

/**
 * The lines for the patient's country. A regional line shows only when it serves the patient's own nation; another
 * nation's line is never shown, and with no nation known only the country-wide lines are. Within a kind the
 * country-wide line comes first. Numbers are passed through exactly as published.
 */
export function selectLines(
  lines: readonly Helpline[],
  country: Country,
  nation: string | null,
  mode: SupportMode,
): SupportLines {
  const eligible = lines.filter((h) => h.country === country && (!h.region || (nation !== null && h.region === nation)));
  const order = PRIMARY[mode];
  const rank = (h: Helpline) => order.indexOf(h.kind) * 2 + (h.region ? 1 : 0);
  const primary = eligible.filter((h) => order.includes(h.kind)).sort((a, b) => rank(a) - rank(b));
  const other = eligible.filter((h) => !order.includes(h.kind));
  return { primary, other };
}

/** The emergency number for a country, as published (for the "call it now" line). */
export function emergencyNumber(lines: readonly Helpline[], country: Country): string | null {
  return lines.find((h) => h.country === country && h.kind === "emergency" && !h.region)?.number ?? null;
}
