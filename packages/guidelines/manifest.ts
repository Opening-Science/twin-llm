import { type GuidelineLicence, type IngestMode } from "./constants";

export type GuidelineManifestEntry = {
  readonly id: string;
  readonly title: string;
  readonly year: number;
  readonly society: string;
  readonly doi: string;
  readonly url: string;
  readonly licence: GuidelineLicence;
  readonly ingestMode: IngestMode;
};

export const GUIDELINE_MANIFEST: readonly GuidelineManifestEntry[] = [
  {
    id: "ean-dementia-2020",
    title: "EAN dementia medical-management issues",
    year: 2020,
    society: "EAN",
    doi: "10.1111/ene.14412",
    url: "https://doi.org/10.1111/ene.14412",
    licence: "cc-by-nc-nd-4.0",
    ingestMode: "full_text",
  },
  {
    id: "ean-ms-palliative-2020",
    title: "EAN palliative care, severe progressive MS",
    year: 2020,
    society: "EAN",
    doi: "10.1111/ene.14248",
    url: "https://doi.org/10.1111/ene.14248",
    licence: "cc-by-nc-4.0",
    ingestMode: "full_text",
  },
  {
    id: "ean-als-2024",
    title: "EAN/ERN EURO-NMD ALS",
    year: 2024,
    society: "EAN/ERN EURO-NMD",
    doi: "10.1111/ene.16264",
    url: "https://doi.org/10.1111/ene.16264",
    licence: "cc-by-nc-nd-4.0",
    ingestMode: "full_text",
  },
  {
    id: "ean-stroke-rehab-2021",
    title: "EAN/EFNR early motor rehab after acute ischaemic stroke",
    year: 2021,
    society: "EAN/EFNR",
    doi: "10.1111/ene.14936",
    url: "https://doi.org/10.1111/ene.14936",
    licence: "publisher",
    ingestMode: "cite_only",
  },
  {
    id: "ean-narcolepsy-2021",
    title: "European narcolepsy, adults and children",
    year: 2021,
    society: "EAN/ESRS/EU-NN",
    doi: "10.1111/jsr.13387",
    url: "https://doi.org/10.1111/jsr.13387",
    licence: "cc-by-nc-nd-4.0",
    ingestMode: "full_text",
  },
  {
    id: "gscm-influenza-children-2024",
    title: "Chinese patent medicine, influenza in children",
    year: 2024,
    society: "GSCM",
    doi: "10.1097/GSCM.0000000000000040",
    url: "https://doi.org/10.1097/GSCM.0000000000000040",
    licence: "cc-by-nc-nd-4.0",
    ingestMode: "full_text",
  },
  {
    id: "esc-pe-2019",
    title: "ESC acute pulmonary embolism",
    year: 2019,
    society: "ESC",
    doi: "10.1093/eurheartj/ehz405",
    url: "https://doi.org/10.1093/eurheartj/ehz405",
    licence: "esc-oup",
    ingestMode: "cite_only",
  },
  {
    id: "esc-ccs-2019",
    title: "ESC chronic coronary syndromes",
    year: 2019,
    society: "ESC",
    doi: "10.1093/eurheartj/ehz425",
    url: "https://doi.org/10.1093/eurheartj/ehz425",
    licence: "esc-oup",
    ingestMode: "cite_only",
  },
  {
    id: "esc-svt-2019",
    title: "ESC supraventricular tachycardia",
    year: 2019,
    society: "ESC",
    doi: "10.1093/eurheartj/ehz467",
    url: "https://doi.org/10.1093/eurheartj/ehz467",
    licence: "esc-oup",
    ingestMode: "cite_only",
  },
  {
    id: "esc-dyslipidaemias-2019",
    title: "ESC/EAS dyslipidaemias",
    year: 2019,
    society: "ESC/EAS",
    doi: "10.1093/eurheartj/ehz455",
    url: "https://doi.org/10.1093/eurheartj/ehz455",
    licence: "esc-oup",
    ingestMode: "cite_only",
  },
];

export const manifestById = (id: string): GuidelineManifestEntry | undefined =>
  GUIDELINE_MANIFEST.find((entry) => entry.id === id);
