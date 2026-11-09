/**
 * How accurate each wearable measure is, from published validation studies.
 *
 * Copied without edits from the TwinLLM wearable-accuracy review (#508):
 * `accuracy-notes.json` (36 notes, one per device and measure) and the rows
 * of `evidence-verified.json` those notes cite. Every cited row was checked
 * against the paper itself (`verifiedIn` names the part read); verified on
 * 9 Nov 2026. Only the notes and the citation fields they cite are kept
 * here. Never edit a number by hand: change the review, verify the row,
 * copy it again.
 *
 * `rows` are the review's evidence-row numbers; `sources` are the papers.
 */

import type { AccuracyNote, AccuracyRow, AccuracySource } from "./types";

export const VERIFIED_ON = "2026-11-09";

export const ACCURACY_SOURCES = {
  "boudreaux-2018": {
    authors: "Boudreaux BD, Hebert EP, Hollander DB, et al",
    year: 2018,
    title:
      "Validity of Wearable Activity Monitors during Cycling and Resistance Exercise",
    journal: "Medicine & Science in Sports & Exercise. 2018;50(3):624-633.",
    doi: "10.1249/MSS.0000000000001471",
    pmid: "29189666",
    url: "https://doi.org/10.1249/MSS.0000000000001471",
    funding: "not stated (abstract only; full text paywalled)",
    conflicts: "not stated (abstract only; full text paywalled)",
  },
  "chinoy-2021": {
    authors: "Chinoy ED, Cuellar JA, Huwa KE, et al",
    year: 2021,
    title:
      "Performance of seven consumer sleep-tracking devices compared with polysomnography",
    journal: "Sleep. 2021;44(5):zsaa291.",
    doi: "10.1093/sleep/zsaa291",
    pmid: "33378539",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8120339/",
    funding: "Office of Naval Research, Code 34 (work unit N1701)",
    conflicts:
      "Authors declare no financial or nonfinancial conflicts; no device-company funding or involvement; EarlySense, ResMed, Fatigue Science, SleepScore Labs gave access to EBE device data (Fitbit data via Fitabase)",
  },
  "dial-2025": {
    authors: "Dial MB, Hollander ME, Vatne EA, Emerson AM, Edwards NA, Hagen JA",
    year: 2025,
    title:
      "Validation of nocturnal resting heart rate and heart rate variability in consumer wearables",
    journal: "Physiological Reports. 2025;13(16):e70527.",
    doi: "10.14814/phy2.70527",
    pmid: "40834291",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12367097/",
    funding:
      "This study was financially supported by the Air Force Research Laboratory (AFRL).",
    conflicts:
      "The authors declare that they have no competing interests. (No Oura/WHOOP affiliation or device donation stated.)",
  },
  "gielen-2026": {
    authors: "Gielen J, Van Oost CN, Debard G, et al",
    year: 2026,
    title:
      "Accuracy of Optical Heart Rate Measurements for 10 Commercial Wearables in Different Climate Conditions and Activities: Instrument Validation Study",
    journal: "JMIR Formative Research. 2026;10:e85186.",
    doi: "10.2196/85186",
    pmid: "41701929",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12912460/",
    funding:
      "Internal KU Leuven funding, project StressTRACS (C3/23/043); funder had no role",
    conflicts: "None declared (no devices donated or industry ties stated)",
  },
  "hajjboutros-2023": {
    authors: "Hajj-Boutros G, Landry-Duval MA, Comtois AS, Gouspillou G, Karelis AD",
    year: 2023,
    title:
      "Wrist-worn devices for the measurement of heart rate and energy expenditure: A validation study for the Apple Watch 6, Polar Vantage V and Fitbit Sense",
    journal: "European Journal of Sport Science. 2023;23(2):165-177.",
    doi: "10.1080/17461391.2021.2023656",
    pmid: "34957939",
    url: "https://doi.org/10.1080/17461391.2021.2023656",
    funding:
      "Grants list (Europe PMC): Universite du Quebec a Montreal; full text not accessed",
    conflicts: "not stated (full text paywalled)",
  },
  "khodr-2024": {
    authors: "Khodr R, Kamal L, Minerbi A, Gupta G",
    year: 2024,
    title:
      "Accuracy, Utility and Applicability of the WHOOP Wearable Monitoring Device in Health, Wellness and Performance - a systematic review",
    journal: "medRxiv preprint 2024.01.04.24300784 (v1, 4 Jan 2024; not peer reviewed).",
    doi: "10.1101/2024.01.04.24300784",
    pmid: null,
    url: "https://doi.org/10.1101/2024.01.04.24300784",
    funding: "This study did not receive any funding",
    conflicts: "The authors have declared no competing interest",
  },
  "kristiansson-2023": {
    authors:
      "Kristiansson E, Fridolfsson J, Arvidsson D, Holmang A, Borjesson M, Andersson-Hall U",
    year: 2023,
    title:
      "Validation of Oura ring energy expenditure and steps in laboratory and free-living",
    journal: "BMC Medical Research Methodology. 2023;23:50.",
    doi: "10.1186/s12874-023-01868-x",
    pmid: "36829120",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9950693/",
    funding:
      "Emil and Wera Cornell Foundation, Tore Nilson Foundation, Erik & Lily Philipsons foundation, Swedish Heart Lung Foundation, Swedish ALF agreement (ALFGBG-965249, ALFGBG-720851); OA by University of Gothenburg",
    conflicts:
      "The authors declare no competing interests (no Oura affiliation; device sourcing not stated)",
  },
  "lambe-2026": {
    authors: "Lambe R, Schumann M, Hamilton S, et al",
    year: 2026,
    title:
      "The accuracy of VO2 max, heart rate and energy expenditure measurements from Google Pixel Watch 3",
    journal: "PLOS ONE. 2026;21:e0356808.",
    doi: "10.1371/journal.pone.0356808",
    pmid: "42743109",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC13577386/",
    funding:
      "Google LLC (Google Research) funded the work (to CD); funder had no role in design, data collection, analysis or manuscript",
    conflicts:
      "Authors received Google LLC funding for this work; state research team is independent of Google LLC; no employment/equity declared",
  },
  "lee-2023": {
    authors: "Lee T, Cho Y, Cha KS, et al",
    year: 2023,
    title:
      "Accuracy of 11 Wearable, Nearable, and Airable Consumer Sleep Trackers: Prospective Multicenter Validation Study",
    journal: "JMIR mHealth and uHealth. 2023;11:e50983.",
    doi: "10.2196/50983",
    pmid: "37917155",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10654909/",
    funding:
      "Institute of Information & Communications Technology Planning & Evaluation (IITP) grant, Korean government (MSIT; RS-2022-00156561)",
    conflicts:
      "YC is director of Clionic Lifecare Clinic (a study site). Authors affiliated with Asleep and CAK hold stocks or stock options in Asleep, developer of SleepRoutine, one of the 11 compared trackers (its algorithm was trained on SNUBH data). No Oura/WHOOP/Fitbit/Google ties declared.",
  },
  "lee-2026": {
    authors: "Lee S, Tu A, Li Y, Kendzerska T, Wu R",
    year: 2026,
    title:
      "Fitbit Sense 2 in hospitalized general medicine patients: A pilot study assessing feasibility and validity of specific measures",
    journal: "International Journal of Medical Informatics. 2026;222:106704.",
    doi: "10.1016/j.ijmedinf.2026.106704",
    pmid: "42691870",
    url: "https://doi.org/10.1016/j.ijmedinf.2026.106704",
    funding: "not stated (abstract/PubMed record; full text not accessible)",
    conflicts:
      "none declared (PubMed CoiStatement: no known competing financial interests)",
  },
  "miller-2020": {
    authors:
      "Miller DJ, Lastella M, Scanlan AT, Bellenger C, Halson SL, Roach GD, Sargent C",
    year: 2020,
    title:
      "A validation study of the WHOOP strap against polysomnography to assess sleep",
    journal: "Journal of Sports Sciences. 2020;38(22):2631-2636.",
    doi: "10.1080/02640414.2020.1797448",
    pmid: "32713257",
    url: "https://doi.org/10.1080/02640414.2020.1797448",
    funding:
      "Australian Institute of Sport; Australian Research Council DP160104909 (Europe PMC grant list)",
    conflicts:
      "not stated (full text paywalled, T&F 403). Abstract: sleeps were scored by WHOOP with proprietary algorithms; same CQU group later declared WHOOP research support (funding, equipment) and WHOOP sponsorship of D.J. Miller's post",
  },
  "miller-2022": {
    authors: "Miller DJ, Sargent C, Roach GD",
    year: 2022,
    title:
      "A Validation of Six Wearable Devices for Estimating Sleep, Heart Rate and Heart Rate Variability in Healthy Adults",
    journal: "Sensors. 2022;22(16):6317.",
    doi: "10.3390/s22166317",
    pmid: "36016077",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9412437/",
    funding:
      "Australian Institute of Sport; wearables companies had no input in design or interpretation",
    conflicts:
      "Roach, Sargent and Miller are in the CQU Sleep Lab, which receives research support (funding, equipment) from WHOOP Inc.; WHOOP not involved in design, conduct or reporting. WHOOP staff (naive to PSG/ECG) supplied the 30-s epoch sleep data and R-R intervals",
  },
  "moghaddam-2025": {
    authors: "Moghaddam M, Collins JP, Gardner CE, Rabel MC",
    year: 2025,
    title:
      "Impact of Anatomical Placement on the Accuracy of Wearable Heart Rate Monitors During Rest and Various Exercise Intensities",
    journal: "Sensors. 2025;26(1):176.",
    doi: "10.3390/s26010176",
    pmid: "41516615",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12788198/",
    funding: "This research received no external funding.",
    conflicts:
      "No competing-interest declaration in the usual sense; the COI section only states results are presented honestly without fabrication. No WHOOP/Polar/Garmin affiliation, funding or device donation reported.",
  },
  "robbins-2024": {
    authors: "Robbins R, Weaver MD, Sullivan JP, et al",
    year: 2024,
    title:
      "Accuracy of Three Commercial Wearable Devices for Sleep Tracking in Healthy Adults",
    journal: "Sensors. 2024;24(20):6532.",
    doi: "10.3390/s24206532",
    pmid: "39460013",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11511193/",
    funding:
      "This research was funded by Oura Ring Inc.; conducted at Brigham and Women's Hospital CCI with support from Harvard Catalyst (NIH NCATS UL1 TR002541) and BWH/Harvard",
    conflicts:
      "Robbins is a member of the Oura Ring Medical Advisory Board and reports consulting fees from Oura Ring Inc. (plus hotel/bed companies); Czeisler reports research/education support to BWH from many companies incl. Whoop, Inc., Philips, ResMed, and Actiwatch royalties; Weaver, Quan other consulting; no Fitbit/Google or Apple ties declared; device sourcing not stated",
  },
  "schyvens-2025": {
    authors: "Schyvens A-M, Peters B, Van Oost NC, et al",
    year: 2025,
    title:
      "A performance validation of six commercial wrist-worn wearable sleep-tracking devices for sleep stage scoring compared to polysomnography",
    journal: "SLEEP Advances. 2025;6(2):zpaf021.",
    doi: "10.1093/sleepadvances/zpaf021",
    pmid: null,
    url: "https://academic.oup.com/sleepadvances/article/6/2/zpaf021/8090472",
    funding: "Flanders Innovation & Entrepreneurship - VLAIO (HBC.2021.0387)",
    conflicts:
      "Financial disclosure: authors have no financial arrangements or affiliations; no nonfinancial conflicts. No device-company funding or donation stated.",
  },
  "svensson-2024": {
    authors: "Svensson T, Madhawa K, Nt H, Chung UI, Svensson AK",
    year: 2024,
    title:
      "Validity and reliability of the Oura Ring Generation 3 (Gen3) with Oura sleep staging algorithm 2.0 (OSSA 2.0) when compared to multi-night ambulatory polysomnography: a validation study of 96 participants and 421,045 epochs",
    journal: "Sleep Medicine. 2024;115:251-263.",
    doi: "10.1016/j.sleep.2024.01.020",
    pmid: "38382312",
    url: "https://doi.org/10.1016/j.sleep.2024.01.020",
    funding:
      "Funding section not accessible (paywalled); per PubMed competing-interest statement Oura Health Oy provided financial support to T. Svensson, U. Chung and A.K. Svensson",
    conflicts:
      "Svensson T, Chung UI and Svensson AK report financial support from Oura Health Oy; other authors none declared",
  },
} as const satisfies Readonly<Record<string, AccuracySource>>;

export type AccuracySourceId = keyof typeof ACCURACY_SOURCES;

export const ACCURACY_ROWS: Readonly<Record<number, AccuracyRow<AccuracySourceId>>> = {
  "0": {
    source: "svensson-2024",
    verifiedIn: "abstract",
  },
  "1": {
    source: "svensson-2024",
    verifiedIn: "abstract",
  },
  "7": {
    source: "svensson-2024",
    verifiedIn: "abstract",
  },
  "8": {
    source: "robbins-2024",
    verifiedIn: "full text results",
  },
  "10": {
    source: "robbins-2024",
    verifiedIn: "full text results",
  },
  "17": {
    source: "robbins-2024",
    verifiedIn: "full text results",
  },
  "18": {
    source: "robbins-2024",
    verifiedIn: "full text results",
  },
  "20": {
    source: "robbins-2024",
    verifiedIn: "full text results",
  },
  "27": {
    source: "robbins-2024",
    verifiedIn: "full text results",
  },
  "35": {
    source: "schyvens-2025",
    verifiedIn: "full text table 3",
  },
  "38": {
    source: "schyvens-2025",
    verifiedIn: "full text table 7",
  },
  "39": {
    source: "schyvens-2025",
    verifiedIn: "full text table 7",
  },
  "40": {
    source: "schyvens-2025",
    verifiedIn: "full text table 7",
  },
  "44": {
    source: "schyvens-2025",
    verifiedIn: "full text table 3",
  },
  "47": {
    source: "schyvens-2025",
    verifiedIn: "full text table 7",
  },
  "49": {
    source: "schyvens-2025",
    verifiedIn: "full text table 7",
  },
  "53": {
    source: "schyvens-2025",
    verifiedIn: "full text table 3",
  },
  "57": {
    source: "schyvens-2025",
    verifiedIn: "full text table 7",
  },
  "58": {
    source: "schyvens-2025",
    verifiedIn: "full text table 7",
  },
  "63": {
    source: "miller-2020",
    verifiedIn: "abstract",
  },
  "66": {
    source: "miller-2020",
    verifiedIn: "abstract",
  },
  "74": {
    source: "miller-2022",
    verifiedIn: "full text table 4",
  },
  "78": {
    source: "miller-2022",
    verifiedIn: "full text table 3",
  },
  "81": {
    source: "lee-2023",
    verifiedIn: "full text table 2",
  },
  "83": {
    source: "lee-2023",
    verifiedIn: "full text results",
  },
  "85": {
    source: "lee-2023",
    verifiedIn: "full text table 2",
  },
  "88": {
    source: "lee-2023",
    verifiedIn: "full text table 2",
  },
  "114": {
    source: "chinoy-2021",
    verifiedIn: "full text table 8",
  },
  "119": {
    source: "dial-2025",
    verifiedIn: "full text table 1",
  },
  "121": {
    source: "dial-2025",
    verifiedIn: "full text table 1",
  },
  "122": {
    source: "dial-2025",
    verifiedIn: "full text table 1",
  },
  "124": {
    source: "dial-2025",
    verifiedIn: "full text table 1",
  },
  "125": {
    source: "dial-2025",
    verifiedIn: "full text table 1",
  },
  "127": {
    source: "dial-2025",
    verifiedIn: "full text table 1",
  },
  "128": {
    source: "dial-2025",
    verifiedIn: "full text table 3",
  },
  "129": {
    source: "dial-2025",
    verifiedIn: "full text table 3",
  },
  "131": {
    source: "dial-2025",
    verifiedIn: "full text table 3",
  },
  "132": {
    source: "dial-2025",
    verifiedIn: "full text table 3",
  },
  "134": {
    source: "dial-2025",
    verifiedIn: "full text table 3",
  },
  "135": {
    source: "dial-2025",
    verifiedIn: "full text table 3",
  },
  "155": {
    source: "lee-2026",
    verifiedIn: "abstract",
  },
  "156": {
    source: "moghaddam-2025",
    verifiedIn: "full text table 2",
  },
  "159": {
    source: "moghaddam-2025",
    verifiedIn: "full text table 2",
  },
  "162": {
    source: "moghaddam-2025",
    verifiedIn: "full text table 2",
  },
  "165": {
    source: "moghaddam-2025",
    verifiedIn: "full text table 2",
  },
  "168": {
    source: "moghaddam-2025",
    verifiedIn: "full text table 2",
  },
  "171": {
    source: "moghaddam-2025",
    verifiedIn: "full text table 2",
  },
  "174": {
    source: "moghaddam-2025",
    verifiedIn: "full text table 2",
  },
  "177": {
    source: "moghaddam-2025",
    verifiedIn: "full text table 2",
  },
  "180": {
    source: "moghaddam-2025",
    verifiedIn: "full text table 2",
  },
  "183": {
    source: "moghaddam-2025",
    verifiedIn: "full text table 2",
  },
  "186": {
    source: "moghaddam-2025",
    verifiedIn: "full text table 2",
  },
  "189": {
    source: "moghaddam-2025",
    verifiedIn: "full text table 2",
  },
  "195": {
    source: "gielen-2026",
    verifiedIn: "full text table 1",
  },
  "197": {
    source: "gielen-2026",
    verifiedIn: "full text table 1",
  },
  "199": {
    source: "gielen-2026",
    verifiedIn: "full text table 1",
  },
  "203": {
    source: "gielen-2026",
    verifiedIn: "full text table 1",
  },
  "207": {
    source: "gielen-2026",
    verifiedIn: "full text table 1",
  },
  "211": {
    source: "lambe-2026",
    verifiedIn: "full text results and table 2",
  },
  "214": {
    source: "boudreaux-2018",
    verifiedIn: "abstract",
  },
  "221": {
    source: "kristiansson-2023",
    verifiedIn: "full text table 2",
  },
  "222": {
    source: "kristiansson-2023",
    verifiedIn: "full text table 2",
  },
  "223": {
    source: "kristiansson-2023",
    verifiedIn: "full text table 2",
  },
  "227": {
    source: "lambe-2026",
    verifiedIn: "full text results and table 2",
  },
  "228": {
    source: "hajjboutros-2023",
    verifiedIn: "abstract",
  },
  "229": {
    source: "boudreaux-2018",
    verifiedIn: "abstract",
  },
  "233": {
    source: "lee-2026",
    verifiedIn: "abstract",
  },
  "237": {
    source: "khodr-2024",
    verifiedIn: "full text results",
  },
};

export const ACCURACY_NOTES: readonly AccuracyNote[] = [
  {
    device: "oura",
    measure: "restingHeartRate",
    measureAsReviewed: "resting heart rate (nightly)",
    evidence: "validated",
    note: "Nightly resting heart rate from Oura Gen3 and Ring 4 was on average within about 1 bpm of a chest-strap ECG (CCC 0.97-0.98) over 608 home nights in 13 healthy adults (Dial 2025).",
    funding: null,
    rows: [119, 121, 122, 124],
  },
  {
    device: "oura",
    measure: "hrv",
    measureAsReviewed: "HRV (nightly RMSSD)",
    evidence: "validated",
    note: "Nightly HRV (RMSSD) from Oura Gen3 and Ring 4 agreed closely with a chest-strap ECG (CCC 0.97-0.99, mean error 6-7%) over 609 home nights in 13 healthy adults (Dial 2025).",
    funding: null,
    rows: [128, 129, 131, 132],
  },
  {
    device: "oura",
    measure: "totalSleepTime",
    measureAsReviewed: "total sleep time",
    evidence: "validated",
    note: "Oura Gen3 total sleep time was on average within about 10 minutes of laboratory polysomnography in healthy adults (Robbins 2024; Svensson 2024).",
    funding: "Both studies were funded or supported by Oura.",
    rows: [17, 7],
  },
  {
    device: "oura",
    measure: "sleepWake",
    measureAsReviewed: "sleep/wake detection",
    evidence: "validated",
    note: "Oura Gen3 recognised about 94-95% of polysomnography-scored sleep but only about 73-75% of wake (Svensson 2024; Robbins 2024).",
    funding: "Both studies were funded or supported by Oura.",
    rows: [0, 1, 8],
  },
  {
    device: "oura",
    measure: "sleepStages",
    measureAsReviewed: "sleep stages (4-stage)",
    evidence: "limited",
    note: "Oura Gen3 sleep stages agreed with polysomnography with a Cohen's kappa of 0.65 in healthy adults (Robbins 2024) and 0.35 in sleep-clinic patients (Lee 2023).",
    funding:
      "Robbins 2024 was funded by Oura; Lee 2023 authors hold equity in a competing sleep app.",
    rows: [10, 88],
  },
  {
    device: "oura",
    measure: "exerciseHeartRate",
    measureAsReviewed: "exercise heart rate",
    evidence: "limited",
    note: "During daytime rest, mental stress and walking, Oura Gen3 heart rate differed from ECG by a median of 11 bpm (CCC 0.61) in 10 lab sessions (Gielen 2026).",
    funding: null,
    rows: [195, 197],
  },
  {
    device: "oura",
    measure: "energyExpenditure",
    measureAsReviewed: "energy expenditure",
    evidence: "limited",
    note: "Oura Gen2 energy expenditure tracked lab calorimetry within individuals (r 0.93) but underestimated very fast running by about 3.5 MET and, in daily life, came out about 800 kcal/day above hip and thigh accelerometers (Kristiansson 2023).",
    funding: null,
    rows: [221, 222, 223],
  },
  {
    device: "oura",
    measure: "spo2",
    measureAsReviewed: "SpO2",
    evidence: "none",
    note: "This review found no independent study comparing Oura blood-oxygen readings with a reference oximeter.",
    funding: null,
    rows: [],
  },
  {
    device: "oura",
    measure: "compositeScores",
    measureAsReviewed: "composite scores (Readiness, Sleep Score)",
    evidence: "none",
    note: "This review found no published validation of Oura Readiness or Sleep Score against a reference measure or health outcome.",
    funding: null,
    rows: [],
  },
  {
    device: "whoop",
    measure: "restingHeartRate",
    measureAsReviewed: "resting heart rate (nightly)",
    evidence: "validated",
    note: "Nightly resting heart rate from WHOOP 4.0 was on average within about 1.5 bpm of a chest-strap ECG (CCC 0.91) over 288 home nights in 13 healthy adults (Dial 2025).",
    funding: null,
    rows: [125, 127],
  },
  {
    device: "whoop",
    measure: "hrv",
    measureAsReviewed: "HRV (nightly RMSSD)",
    evidence: "validated",
    note: "Nightly HRV (RMSSD) from WHOOP 4.0 agreed closely with a chest-strap ECG (CCC 0.94, mean error about 8%) over 289 home nights in 13 healthy adults (Dial 2025).",
    funding: null,
    rows: [134, 135],
  },
  {
    device: "whoop",
    measure: "totalSleepTime",
    measureAsReviewed: "total sleep time",
    evidence: "validated",
    note: "WHOOP total sleep time was on average within 12-25 minutes of polysomnography, but single nights in a mixed sleep-clinic sample differed by up to about 2 hours (Miller 2022, WHOOP 3.0; Schyvens 2025, WHOOP 4.0).",
    funding: "Miller 2022 lab receives WHOOP funding and equipment.",
    rows: [74, 35],
  },
  {
    device: "whoop",
    measure: "sleepWake",
    measureAsReviewed: "sleep/wake detection",
    evidence: "validated",
    note: "WHOOP recognised about 94-95% of polysomnography-scored sleep but only 40-51% of wake (Miller 2020; Schyvens 2025).",
    funding: "Miller 2020 lab receives WHOOP support; WHOOP scored the sleep data.",
    rows: [63, 38, 39],
  },
  {
    device: "whoop",
    measure: "sleepStages",
    measureAsReviewed: "sleep stages (4-stage)",
    evidence: "validated",
    note: "WHOOP sleep stages agreed with polysomnography with a Cohen's kappa of 0.37-0.47 across WHOOP 2.0-era, 3.0 and 4.0 studies (Miller 2020; Miller 2022; Schyvens 2025).",
    funding: "Miller 2020/2022 lab receives WHOOP support.",
    rows: [66, 78, 40],
  },
  {
    device: "whoop",
    measure: "exerciseHeartRate",
    measureAsReviewed: "exercise heart rate",
    evidence: "validated",
    note: "WHOOP 4.0 heart rate was within about 2-6% of a chest strap at rest, warm-up and on a graded treadmill, but 12-18% off during burpees at every placement, with the upper arm generally closest (Moghaddam 2025).",
    funding: null,
    rows: [156, 159, 162, 165, 168, 171, 174, 177, 180, 183, 186, 189],
  },
  {
    device: "whoop",
    measure: "energyExpenditure",
    measureAsReviewed: "energy expenditure",
    evidence: "none",
    note: "This review found no independent study comparing WHOOP calorie estimates with a reference method.",
    funding: null,
    rows: [],
  },
  {
    device: "whoop",
    measure: "spo2",
    measureAsReviewed: "SpO2",
    evidence: "none",
    note: "This review found no independent study comparing WHOOP blood-oxygen readings with a reference oximeter.",
    funding: null,
    rows: [],
  },
  {
    device: "whoop",
    measure: "compositeScores",
    measureAsReviewed: "composite scores (Recovery, Strain)",
    evidence: "none",
    note: "No published study has validated WHOOP Recovery or Strain against a reference measure; a 2024 preprint review found only descriptions of how the scores are built (Khodr 2024).",
    funding: null,
    rows: [237],
  },
  {
    device: "fitbit",
    measure: "restingHeartRate",
    measureAsReviewed: "resting heart rate (nightly)",
    evidence: "limited",
    note: "This review found no study of Fitbit nightly resting heart rate against ECG; in 33 hospital inpatients, Fitbit Sense 2 heart rate over 24 hours was on average within 0.3 bpm of a reference monitor (Lee 2026).",
    funding: null,
    rows: [155],
  },
  {
    device: "fitbit",
    measure: "hrv",
    measureAsReviewed: "HRV (nightly RMSSD)",
    evidence: "none",
    note: "This review found no independent study comparing Fitbit nightly HRV with an ECG reference.",
    funding: null,
    rows: [],
  },
  {
    device: "fitbit",
    measure: "totalSleepTime",
    measureAsReviewed: "total sleep time",
    evidence: "validated",
    note: "Fitbit Sense, Sense 2 and Charge 5 total sleep time was on average within 3-11 minutes of polysomnography, but single nights in a mixed sleep-clinic sample differed by up to about 2 hours (Robbins 2024; Schyvens 2025).",
    funding: "Robbins 2024 was funded by Oura.",
    rows: [27, 44, 53],
  },
  {
    device: "fitbit",
    measure: "sleepWake",
    measureAsReviewed: "sleep/wake detection",
    evidence: "validated",
    note: "Fitbit recognised about 92-95% of polysomnography-scored sleep but only about 48-54% of wake (Robbins 2024; Schyvens 2025; Chinoy 2021).",
    funding: null,
    rows: [18, 47, 57, 114],
  },
  {
    device: "fitbit",
    measure: "sleepStages",
    measureAsReviewed: "sleep stages (4-stage)",
    evidence: "validated",
    note: "Fitbit sleep stages agreed with polysomnography with a Cohen's kappa of 0.41-0.55 in healthy adults and sleep-clinic patients (Robbins 2024; Lee 2023; Schyvens 2025).",
    funding:
      "Robbins 2024 was funded by Oura; Lee 2023 authors hold equity in a competing sleep app.",
    rows: [20, 85, 49, 58],
  },
  {
    device: "fitbit",
    measure: "exerciseHeartRate",
    measureAsReviewed: "exercise heart rate",
    evidence: "limited",
    note: "Fitbit heart-rate error depended on model and activity: Charge 6 differed from ECG by a median of 4.5 bpm and Inspire 3 by 14 bpm during rest and walking (Gielen 2026), and older models underestimated more as exercise got harder (Boudreaux 2018).",
    funding: null,
    rows: [199, 203, 214],
  },
  {
    device: "fitbit",
    measure: "energyExpenditure",
    measureAsReviewed: "energy expenditure",
    evidence: "limited",
    note: "No Fitbit model tested met a 10% error threshold for energy expenditure in cycling and resistance exercise (Boudreaux 2018), and Fitbit Sense estimates varied by 13-30% (coefficient of variation) against a metabolic analyser (Hajj-Boutros 2023).",
    funding: null,
    rows: [229, 228],
  },
  {
    device: "fitbit",
    measure: "spo2",
    measureAsReviewed: "SpO2",
    evidence: "limited",
    note: "In a pilot of 33 hospital inpatients, Fitbit Sense 2 blood oxygen read on average 1.7 points above a reference monitor with poor agreement (ICC 0.47), and only 41% of expected readings were recorded (Lee 2026).",
    funding: null,
    rows: [233],
  },
  {
    device: "fitbit",
    measure: "compositeScores",
    measureAsReviewed: "composite scores (Sleep Score, Daily Readiness)",
    evidence: "none",
    note: "This review found no published validation of Fitbit Sleep Score or Daily Readiness Score against a reference measure or health outcome.",
    funding: null,
    rows: [],
  },
  {
    device: "pixel-watch",
    measure: "restingHeartRate",
    measureAsReviewed: "resting heart rate (nightly)",
    evidence: "none",
    note: "This review found no independent study comparing Pixel Watch nightly resting heart rate with ECG.",
    funding: null,
    rows: [],
  },
  {
    device: "pixel-watch",
    measure: "hrv",
    measureAsReviewed: "HRV (nightly RMSSD)",
    evidence: "none",
    note: "This review found no independent study comparing Pixel Watch nightly HRV with an ECG reference.",
    funding: null,
    rows: [],
  },
  {
    device: "pixel-watch",
    measure: "totalSleepTime",
    measureAsReviewed: "total sleep time",
    evidence: "limited",
    note: "This review found no Pixel Watch study reporting total sleep time against polysomnography; the first-generation watch overestimated sleep efficiency by about 13 percentage points in sleep-clinic patients (Lee 2023).",
    funding: "Lee 2023 authors hold equity in a competing sleep app.",
    rows: [83],
  },
  {
    device: "pixel-watch",
    measure: "sleepWake",
    measureAsReviewed: "sleep/wake detection",
    evidence: "none",
    note: "This review found no independent study comparing Pixel Watch sleep/wake detection with polysomnography.",
    funding: null,
    rows: [],
  },
  {
    device: "pixel-watch",
    measure: "sleepStages",
    measureAsReviewed: "sleep stages (4-stage)",
    evidence: "limited",
    note: "First-generation Pixel Watch sleep stages agreed with polysomnography with a Cohen's kappa of 0.40 in 30 sleep-clinic patients (Lee 2023).",
    funding: "Lee 2023 authors hold equity in a competing sleep app.",
    rows: [81],
  },
  {
    device: "pixel-watch",
    measure: "exerciseHeartRate",
    measureAsReviewed: "exercise heart rate",
    evidence: "limited",
    note: "Pixel Watch 2 heart rate differed from ECG by a median of 4.9 bpm during rest and walking (Gielen 2026), and Pixel Watch 3 read on average 2.4 bpm low in a maximal treadmill test, with single readings up to about 24 bpm off (Lambe 2026).",
    funding: "Lambe 2026 was funded by Google.",
    rows: [207, 211],
  },
  {
    device: "pixel-watch",
    measure: "energyExpenditure",
    measureAsReviewed: "energy expenditure",
    evidence: "limited",
    note: "Pixel Watch 3 energy expenditure over a maximal treadmill test was off by about 15% on average (Lambe 2026).",
    funding: "Lambe 2026 was funded by Google.",
    rows: [227],
  },
  {
    device: "pixel-watch",
    measure: "spo2",
    measureAsReviewed: "SpO2",
    evidence: "none",
    note: "This review found no independent study comparing Pixel Watch blood-oxygen readings with a reference oximeter.",
    funding: null,
    rows: [],
  },
  {
    device: "pixel-watch",
    measure: "compositeScores",
    measureAsReviewed: "composite scores (Daily Readiness)",
    evidence: "none",
    note: "This review found no published validation of the Pixel Watch / Fitbit Daily Readiness Score against a reference measure or health outcome.",
    funding: null,
    rows: [],
  },
];
