import type { Layer } from "./gbd-boundaries";

/**
 * GBD reports the United Kingdom at three levels: the four nations, the nine
 * regions of England and England's local authorities (#421). Natural Earth's
 * GBR admin-1 units are local units, so the two upper levels are built by
 * joining them: local unit to English region to nation.
 *
 * Source of the English regions: ONS, "Local Authority District to Region
 * (December 2018) Lookup in England" and "Local Authority District to County
 * (December 2018) Lookup in England" (ONS Open Geography Portal, Open
 * Government Licence v3.0). Natural Earth's English units are 2009 to 2019
 * districts, unitary authorities and two-tier counties; each was looked up
 * by name as a district or, for a county, through its districts, which all
 * lie in one region. ONS's region agrees with Natural Earth's own `region`
 * field for all 152. Scotland, Wales and Northern Ireland are Natural
 * Earth's `geonunit`. Where Natural Earth's units differ from today's ONS
 * units is in public/geo/natural-earth/README.md.
 *
 * Codes are Natural Earth's `iso_3166_2`. GB-WRL is Wirral and GB-SHN St
 * Helens, whatever Natural Earth names them (gbd-boundaries.ts renames them).
 */

export type EnglishRegion = Readonly<{
  /** GBD location id; the boundary's code is `GBD-<id>`, as England's regions have no ISO 3166-2 code. */
  gbdId: number;
  /** GBD's name. */
  name: string;
  /** ONS's name and code (E12), kept as another name of the boundary. */
  onsName: string;
  onsCode: string;
  members: readonly string[];
}>;

export const ENGLISH_REGIONS: readonly EnglishRegion[] = [
  {
    gbdId: 4618,
    name: "North East England",
    onsName: "North East",
    onsCode: "E12000001",
    members: [
      "GB-DAL",
      "GB-DUR",
      "GB-GAT",
      "GB-HPL",
      "GB-MDB",
      "GB-NBL",
      "GB-NET",
      "GB-NTY",
      "GB-RCC",
      "GB-SND",
      "GB-STT",
      "GB-STY",
    ],
  },
  {
    gbdId: 4619,
    name: "North West England",
    onsName: "North West",
    onsCode: "E12000002",
    members: [
      "GB-BBD",
      "GB-BOL",
      "GB-BPL",
      "GB-BUR",
      "GB-CHE",
      "GB-CHW",
      "GB-CMA",
      "GB-HAL",
      "GB-KWL",
      "GB-LAN",
      "GB-LIV",
      "GB-MAN",
      "GB-OLD",
      "GB-RCH",
      "GB-SFT",
      "GB-SHN",
      "GB-SKP",
      "GB-SLF",
      "GB-TAM",
      "GB-TRF",
      "GB-WGN",
      "GB-WRL",
      "GB-WRT",
    ],
  },
  {
    gbdId: 4620,
    name: "Yorkshire and the Humber",
    onsName: "Yorkshire and The Humber",
    onsCode: "E12000003",
    members: [
      "GB-BNS",
      "GB-BRD",
      "GB-CLD",
      "GB-DNC",
      "GB-ERY",
      "GB-KHL",
      "GB-KIR",
      "GB-LDS",
      "GB-NEL",
      "GB-NLN",
      "GB-NYK",
      "GB-ROT",
      "GB-SHF",
      "GB-WKF",
      "GB-YOR",
    ],
  },
  {
    gbdId: 4621,
    name: "East Midlands",
    onsName: "East Midlands",
    onsCode: "E12000004",
    members: [
      "GB-DBY",
      "GB-DER",
      "GB-LCE",
      "GB-LEC",
      "GB-LIN",
      "GB-NGM",
      "GB-NTH",
      "GB-NTT",
      "GB-RUT",
    ],
  },
  {
    gbdId: 4622,
    name: "West Midlands",
    onsName: "West Midlands",
    onsCode: "E12000005",
    members: [
      "GB-BIR",
      "GB-COV",
      "GB-DUD",
      "GB-HEF",
      "GB-SAW",
      "GB-SHR",
      "GB-SOL",
      "GB-STE",
      "GB-STS",
      "GB-TFW",
      "GB-WAR",
      "GB-WLL",
      "GB-WLV",
      "GB-WOR",
    ],
  },
  {
    gbdId: 4623,
    name: "East of England",
    onsName: "East of England",
    onsCode: "E12000006",
    members: [
      "GB-BDF",
      "GB-CAM",
      "GB-CBF",
      "GB-ESS",
      "GB-HRT",
      "GB-LUT",
      "GB-NFK",
      "GB-PTE",
      "GB-SFK",
      "GB-SOS",
      "GB-THR",
    ],
  },
  {
    gbdId: 4624,
    name: "Greater London",
    onsName: "London",
    onsCode: "E12000007",
    members: [
      "GB-BDG",
      "GB-BEN",
      "GB-BEX",
      "GB-BNE",
      "GB-BRY",
      "GB-CMD",
      "GB-CRY",
      "GB-EAL",
      "GB-ENF",
      "GB-GRE",
      "GB-HAV",
      "GB-HCK",
      "GB-HIL",
      "GB-HMF",
      "GB-HNS",
      "GB-HRW",
      "GB-HRY",
      "GB-ISL",
      "GB-KEC",
      "GB-KTT",
      "GB-LBH",
      "GB-LEW",
      "GB-LND",
      "GB-MRT",
      "GB-NWM",
      "GB-RDB",
      "GB-RIC",
      "GB-STN",
      "GB-SWK",
      "GB-TWH",
      "GB-WFT",
      "GB-WND",
      "GB-WSM",
    ],
  },
  {
    gbdId: 4625,
    name: "South East England",
    onsName: "South East",
    onsCode: "E12000008",
    members: [
      "GB-BKM",
      "GB-BNH",
      "GB-BRC",
      "GB-ESX",
      "GB-HAM",
      "GB-IOW",
      "GB-KEN",
      "GB-MDW",
      "GB-MIK",
      "GB-OXF",
      "GB-POR",
      "GB-RDG",
      "GB-SLG",
      "GB-SRY",
      "GB-STH",
      "GB-WBK",
      "GB-WNM",
      "GB-WOK",
      "GB-WSX",
    ],
  },
  {
    gbdId: 4626,
    name: "South West England",
    onsName: "South West",
    onsCode: "E12000009",
    members: [
      "GB-BAS",
      "GB-BMH",
      "GB-BST",
      "GB-CON",
      "GB-DEV",
      "GB-DOR",
      "GB-GLS",
      "GB-IOS",
      "GB-NSM",
      "GB-PLY",
      "GB-POL",
      "GB-SGC",
      "GB-SOM",
      "GB-SWD",
      "GB-TOB",
      "GB-WIL",
    ],
  },
];

export type Nation = Readonly<{
  /** ISO 3166-2 code of the nation. */
  code: string;
  name: string;
  members: readonly string[];
}>;

/** The three nations besides England, by Natural Earth's `geonunit`. */
export const OTHER_NATIONS: readonly Nation[] = [
  {
    code: "GB-NIR",
    name: "Northern Ireland",
    members: [
      "GB-ANT",
      "GB-ARD",
      "GB-ARM",
      "GB-BFS",
      "GB-BLA",
      "GB-BLY",
      "GB-BNB",
      "GB-CGV",
      "GB-CKF",
      "GB-CKT",
      "GB-CLR",
      "GB-CSR",
      "GB-DGN",
      "GB-DOW",
      "GB-DRY",
      "GB-FER",
      "GB-LMV",
      "GB-LRN",
      "GB-LSB",
      "GB-MFT",
      "GB-MYL",
      "GB-NDN",
      "GB-NTA",
      "GB-NYM",
      "GB-OMH",
      "GB-STB",
    ],
  },
  {
    code: "GB-SCT",
    name: "Scotland",
    members: [
      "GB-ABD",
      "GB-ABE",
      "GB-AGB",
      "GB-ANS",
      "GB-CLK",
      "GB-DGY",
      "GB-DND",
      "GB-EAY",
      "GB-EDH",
      "GB-EDU",
      "GB-ELN",
      "GB-ELS",
      "GB-ERW",
      "GB-FAL",
      "GB-FIF",
      "GB-GLG",
      "GB-HLD",
      "GB-IVC",
      "GB-MLN",
      "GB-MRY",
      "GB-NAY",
      "GB-NLK",
      "GB-ORK",
      "GB-PKN",
      "GB-RFW",
      "GB-SAY",
      "GB-SCB",
      "GB-SLK",
      "GB-STG",
      "GB-WDU",
      "GB-WLN",
      "GB-ZET",
    ],
  },
  {
    code: "GB-WLS",
    name: "Wales",
    members: [
      "GB-AGY",
      "GB-BGE",
      "GB-BGW",
      "GB-CAY",
      "GB-CGN",
      "GB-CMN",
      "GB-CRF",
      "GB-CWY",
      "GB-DEN",
      "GB-FLN",
      "GB-GWN",
      "GB-MON",
      "GB-MTY",
      "GB-NTL",
      "GB-NWP",
      "GB-PEM",
      "GB-POW",
      "GB-RCT",
      "GB-SWA",
      "GB-TOF",
      "GB-VGL",
      "GB-WRX",
    ],
  },
];

export const ENGLAND: Nation = {
  code: "GB-ENG",
  name: "England",
  members: ENGLISH_REGIONS.flatMap((region) => region.members),
};

export const UK_NATIONS: readonly Nation[] = [ENGLAND, ...OTHER_NATIONS];

/** The English region a Natural Earth local unit lies in, or null outside England. Pure. */
export const englishRegionOf = (code: string): EnglishRegion | null =>
  ENGLISH_REGIONS.find((region) => region.members.includes(code)) ?? null;

/** The nation a Natural Earth local unit lies in, or null when the code is not a UK unit. Pure. */
export const nationOf = (code: string): Nation | null =>
  UK_NATIONS.find((nation) => nation.members.includes(code)) ?? null;

/**
 * The UK's two upper levels as dissolve rules over Natural Earth's local
 * units: `nations` (England, Scotland, Wales, Northern Ireland) and `regions`
 * (the UK's 12 ITL1 regions: England's nine with the other three nations,
 * so a map of England's regions still shows the rest of the UK). Pure.
 */
export const ukLayers = (): readonly Layer[] => {
  const nations = UK_NATIONS.map((nation) => ({
    code: nation.code,
    name: nation.name,
    members: nation.members,
  }));
  return [
    { layer: "nations", units: nations },
    {
      layer: "regions",
      units: [
        ...ENGLISH_REGIONS.map((region) => ({
          code: `GBD-${region.gbdId}`,
          name: region.name,
          members: region.members,
          ...(region.onsName === region.name ? {} : { names: [region.onsName] }),
        })),
        ...nations.filter((nation) => nation.code !== ENGLAND.code),
      ],
    },
  ];
};
