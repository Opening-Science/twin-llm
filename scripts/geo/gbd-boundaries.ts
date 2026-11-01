/**
 * How Natural Earth's admin-1 units become the boundaries GBD's subnational
 * units are matched to (#397). Reviewed by hand, country by country; the
 * method and sources are in public/geo/natural-earth/README.md and the
 * resulting match rate in docs/gbd-map-coverage.md.
 *
 * Four kinds of rule, applied in this order to one country's units:
 *
 * - `borrow`: Natural Earth units filed under another country, drawn here
 *   too because GBD reports them here (Crimea and Sevastopol under Ukraine).
 * - `dissolve`: several Natural Earth units joined into one GBD unit, their
 *   shared borders removed (Italy's provinces into its regions). A unit's
 *   members are Natural Earth codes, or every unit whose `field` has `value`.
 * - `recode`: Natural Earth codes replaced by the current ISO 3166-2 code,
 *   where Natural Earth still carries a code ISO has since changed (Poland,
 *   Iran, India, South Africa, Mexico City) or has a plain error (Moscow
 *   city and oblast swapped). Keyed by Natural Earth code, or code and name
 *   where Natural Earth gives two units one code.
 * - `rename`: Natural Earth names that are wrong for the code they carry.
 *
 * `aliases` give GBD names that match no Natural Earth name, to the code of
 * the boundary they name. A dissolved unit with no ISO code gets a code of
 * the form `GBD-<location id>`, and GBD's name as its own.
 */

export type Members =
  | readonly string[]
  | Readonly<{ field: string; value: string; except?: readonly string[] }>;

export type Dissolve = Readonly<{
  code: string;
  name: string;
  members: Members;
  /** Other names the joined unit goes by (Natural Earth's region name). */
  names?: readonly string[];
}>;

export type CountryRules = Readonly<{
  borrow?: readonly string[];
  dissolve?: readonly Dissolve[];
  recode?: Readonly<Record<string, string>>;
  rename?: Readonly<Record<string, string>>;
  aliases?: Readonly<Record<string, string>>;
}>;

/** Italy: Natural Earth has the 107 provinces; GBD has the 19 regions and the two autonomous provinces of Trentino-Alto Adige. */
const ITALY_REGIONS: readonly (readonly [string, string, string?])[] = [
  ["IT-65", "Abruzzo"],
  ["IT-77", "Basilicata"],
  ["IT-78", "Calabria"],
  ["IT-72", "Campania"],
  ["IT-45", "Emilia-Romagna"],
  ["IT-36", "Friuli-Venezia Giulia"],
  ["IT-62", "Lazio"],
  ["IT-42", "Liguria"],
  ["IT-25", "Lombardia"],
  ["IT-57", "Marche"],
  ["IT-67", "Molise"],
  ["IT-21", "Piemonte"],
  ["IT-75", "Puglia", "Apulia"],
  ["IT-88", "Sardegna"],
  ["IT-82", "Sicilia", "Sicily"],
  ["IT-52", "Toscana"],
  ["IT-55", "Umbria"],
  ["IT-23", "Valle d'Aosta"],
  ["IT-34", "Veneto"],
];

export const GBD_BOUNDARY_RULES: Readonly<Record<string, CountryRules>> = {
  GBR: {
    // Natural Earth files Wirral under GB-WRL with the name Halton (Halton is
    // GB-HAL) and St Helens under GB-SHN with the name Merseyside.
    rename: { "GB-WRL": "Wirral", "GB-SHN": "St Helens" },
    aliases: {
      "Bristol, City of": "GB-BST",
      "County Durham": "GB-DUR",
      "Herefordshire, County of": "GB-HEF",
      "Kingston upon Hull, City of": "GB-KHL",
      "Windsor and Maidenhead": "GB-WNM",
    },
  },
  IND: {
    dissolve: [
      {
        code: "GBD-4854",
        name: "Jammu & Kashmir and Ladakh",
        members: ["IN-JK", "IN-LA"],
      },
      {
        code: "GBD-44538",
        name: "Other Union Territories",
        members: ["IN-AN", "IN-CH", "IN-DH", "IN-LD", "IN-PY"],
      },
    ],
    // ISO 3166-2 change of 23 November 2023 (Wikipedia "ISO 3166-2:IN", changes).
    recode: { "IN-CT": "IN-CG", "IN-OR": "IN-OD", "IN-TG": "IN-TS", "IN-UT": "IN-UK" },
  },
  IRN: {
    // The ISO 3166-2 change of 24 November 2020 renumbered the provinces (Wikipedia
    // "ISO 3166-2:IR", changes). Natural Earth keeps the old numbers and gives
    // Alborz Tehran's old code, IR-07.
    recode: {
      "IR-07|Alborz": "IR-30",
      "IR-07|Tehran": "IR-23",
      "IR-01": "IR-03",
      "IR-02": "IR-04",
      "IR-03": "IR-24",
      "IR-04": "IR-10",
      "IR-05": "IR-16",
      "IR-06": "IR-18",
      "IR-08": "IR-14",
      "IR-10": "IR-06",
      "IR-11": "IR-19",
      "IR-12": "IR-20",
      "IR-13": "IR-11",
      "IR-14": "IR-07",
      "IR-15": "IR-08",
      "IR-16": "IR-12",
      "IR-17": "IR-05",
      "IR-18": "IR-17",
      "IR-19": "IR-01",
      "IR-20": "IR-15",
      "IR-21": "IR-02",
      "IR-22": "IR-00",
      "IR-23": "IR-22",
      "IR-24": "IR-13",
      "IR-25": "IR-21",
      "IR-26": "IR-25",
      "IR-28": "IR-26",
      "IR-30": "IR-09",
      "IR-31": "IR-28",
    },
  },
  ITA: {
    dissolve: ITALY_REGIONS.map(([code, name, other]) => ({
      code,
      name,
      members: { field: "region_cod", value: code },
      ...(other === undefined ? {} : { names: [other] }),
    })),
  },
  KEN: {
    // Nairobi province and Nairobi City County (KE-30) are the same area.
    recode: { "KE-110": "KE-30" },
  },
  MEX: { recode: { "MX-DIF": "MX-CMX" } },
  NOR: {
    // Natural Earth has the 19 counties before 2020; GBD 2023 has the 11 of
    // 2020 to 2023. Each 2020 county is drawn as the old counties it joined.
    dissolve: [
      { code: "NO-30", name: "Viken", members: ["NO-01", "NO-02", "NO-06"] },
      { code: "NO-34", name: "Innlandet", members: ["NO-04", "NO-05"] },
      { code: "NO-38", name: "Vestfold og Telemark", members: ["NO-07", "NO-08"] },
      { code: "NO-42", name: "Agder", members: ["NO-09", "NO-10"] },
      { code: "NO-46", name: "Vestland", members: ["NO-12", "NO-14"] },
      { code: "NO-50", name: "Trøndelag", members: ["NO-16", "NO-17"] },
      { code: "NO-54", name: "Troms og Finnmark", members: ["NO-19", "NO-20"] },
    ],
  },
  PHL: {
    // Natural Earth splits the National Capital Region into its cities, all
    // coded PH-MNL; ISO and GBD have the region (PH-00).
    dissolve: [{ code: "PH-00", name: "National Capital Region", members: ["PH-MNL"] }],
  },
  POL: {
    // The ISO 3166-2 change of 26 November 2018 replaced the letter codes with numbers
    // (Wikipedia "ISO 3166-2:PL", changes).
    recode: {
      "PL-DS": "PL-02",
      "PL-KP": "PL-04",
      "PL-LU": "PL-06",
      "PL-LB": "PL-08",
      "PL-LD": "PL-10",
      "PL-MA": "PL-12",
      "PL-MZ": "PL-14",
      "PL-OP": "PL-16",
      "PL-PK": "PL-18",
      "PL-PD": "PL-20",
      "PL-PM": "PL-22",
      "PL-SL": "PL-24",
      "PL-SK": "PL-26",
      "PL-WN": "PL-28",
      "PL-WP": "PL-30",
      "PL-ZP": "PL-32",
    },
  },
  RUS: {
    // Natural Earth has Moscow city and Moscow oblast the wrong way round.
    recode: { "RU-MOW|Moskovskaya": "RU-MOS", "RU-MOS|Moskva": "RU-MOW" },
  },
  SWE: {
    dissolve: [
      {
        code: "GBD-4940",
        name: "Sweden except Stockholm",
        members: { field: "adm0_a3", value: "SWE", except: ["SE-AB"] },
      },
    ],
  },
  UKR: {
    // GBD reports Crimea and Sevastopol under Ukraine, as ISO 3166-2 does;
    // Natural Earth files them under Russia.
    borrow: ["UA-43", "UA-40"],
    dissolve: [
      {
        code: "GBD-50559",
        name: "Ukraine (without Crimea & Sevastopol)",
        members: { field: "adm0_a3", value: "UKR" },
      },
    ],
  },
  // ISO 3166-2 change of 2 March 2020 (Wikipedia "ISO 3166-2:ZA", changes).
  ZAF: { recode: { "ZA-GT": "ZA-GP", "ZA-NL": "ZA-KZN" } },
};

export type UnmatchedReason = Readonly<{ pattern: RegExp; reason: string }>;

/**
 * GBD units left without a boundary on purpose, and why. The match-rate
 * report prints the reason next to each.
 */
export const UNMATCHED_ON_PURPOSE: Readonly<Record<string, readonly UnmatchedReason[]>> =
  {
    GBR: [
      {
        pattern: /^(England|Scotland|Wales|Northern Ireland)$/,
        reason:
          "a nation; the boundary file has local authorities, one level per country",
      },
      {
        pattern:
          /^(East Midlands|East of England|Greater London|North East England|North West England|South East England|South West England|West Midlands|Yorkshire and the Humber)$/,
        reason: "a region of England; the boundary file has local authorities",
      },
    ],
    IDN: [
      {
        pattern: /^North Kalimantan$/,
        reason:
          "made a province in 2012; Natural Earth still draws it in East Kalimantan",
      },
    ],
    IND: [
      {
        pattern: /, (Rural|Urban)$/,
        reason: "the urban or rural population of a state, not an area",
      },
    ],
    KEN: [
      {
        pattern: /./,
        reason:
          "a county; Natural Earth has the eight former provinces, which hold several counties each",
      },
    ],
    NZL: [
      {
        pattern: /population$/,
        reason: "a population group, not an area",
      },
    ],
    PHL: [
      {
        pattern: /^Davao Occidental$/,
        reason: "made a province in 2013; Natural Earth still draws it in Davao del Sur",
      },
      {
        pattern: /^Dinagat Islands$/,
        reason:
          "made a province in 2006; Natural Earth still draws it in Surigao del Norte",
      },
    ],
  };
