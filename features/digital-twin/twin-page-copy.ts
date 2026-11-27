/**
 * Copy for the Digital Twin page frame: section titles, one note per section
 * and the Sources lines. In one place so `lint:claims` checks it. Each line
 * says where data comes from, never what it means for a person.
 */
export const PAGE_TITLE = "Digital Twin";
export const YOUR_TWIN = "Your Twin";
export const YOUR_DAY = "Your Day";
export const YOUR_TEN_DAYS = "Your 10-Days";
export const BODY_TWIN = "Body twin";
export const BODY_TWIN_NOTE =
  "A 3D body with reference anatomy and biomarkers. Not a statement about a person.";
export const SOURCES_TITLE = "Sources";
export const SOURCES_NOTE = "Where this twin's data comes from.";
/** Title of the collapsible list under Sources. */
export const SOURCES_PANEL = "By part";
export const GENOME_TWIN = "Genome twin";
export const GENOME_NOTE =
  "Your released Ark report, the slot inventory and recent reads. The helix is decorative.";
export const GENOME_EMPTY = "No genome twin on this account.";

/** The rsid-genotypes run and its released report. */
export const GENOME_REPORT_COPY = {
  title: "rsID genotypes",
  note: "Runs the rsid-genotypes app on your Ark. It reads up to eleven public CPIC / PharmGKB sites, each one you switch on, and releases only their recorded genotypes after you review the report on your phone. The report stays on this machine.",
  run: "Run on Ark",
  runAgain: "Run again",
  empty: "No report released yet.",
  approveTitle: "Waiting for your phone",
  steps: [
    {
      title: "Approve on your phone",
      body: "Approve the run in Ark Companion within 5 minutes, and switch on the sites you want read.",
    },
    {
      title: "Review and release the report on your phone",
      body: "Once the app ends, read the report and release it within 10 minutes. Nothing reaches this machine until you do.",
    },
  ],
  approveNote: "Keep this tab open and the Ark Hub tab closed.",
  noCall: "no call",
  notGranted: "not granted",
  notGrantedNote:
    "Not granted: the site was switched off at approval or is not on the Ark. The app cannot tell which.",
  tableCaption: "Recorded genotypes at the eleven panel sites",
} as const;

export const SOURCE_LABEL = {
  body: "Body",
  biomarkers: "Biomarkers",
  vitals: "Live vitals",
} as const;

export const SOURCE_TEXT = {
  demoBody: "Synthetic ANNY body, not a person.",
  scans: "BodyLoop scans of this subject.",
  demoBiomarkers: "Lab values of a synthetic cohort person, not of this body.",
  selfBiomarkers: "Your connected wearables.",
  demoVitals: "Vitals of a synthetic cohort person.",
  selfVitals: "Your connected wearables.",
} as const;

/** One plain sentence per missing source, so no part of the page is a blank box. */
export const EMPTY_TEXT = {
  scans: "No scans for this subject yet.",
  biomarkers: "No biomarker values for this subject.",
  biomarkersFailed: "Could not load biomarker values.",
  vitals: "No vitals for this subject.",
} as const;

/** Your Day: the replay clock and seek bar, date picker, viewer and charts. */
export const YOUR_DAY_COPY = {
  clock: "Replay Clock",
  replayTitle: "Daily replay",
  replay: {
    noDemoDay: "No demo replay data for this date.",
    noData: "No replay data",
    demoData: "Demo data",
    play: "Play",
    pause: "Pause",
    replay: "Replay",
    speed: "Replay speed",
    speedDefault: "Slow",
    speedFast: "Fast",
    seek: "Seek replay time",
    seekTo: "Seek to",
    noActiveEvent: "No active event",
    eventTypes: "Event types",
    noEvents: "No events for this day.",
    kinds: {
      workout: "Workout",
      activity: "Activity",
      sleep: "Sleep",
      heart: "Heart rate",
      glucose: "Glucose",
    },
  },
  viewerRegion: "Anatomy viewer",
  chartsTitle: "Biomarker charts",
  picker: {
    group: "Replay date picker",
    dialog: "Choose replay date",
    current: "Replay date: ",
    empty: "Choose date",
    selected: "Selected date",
    today: "Today",
    previousDay: "Previous day",
    nextDay: "Next day",
  },
  chart: {
    glucose: "Glucose",
    bloodGlucose: "Blood glucose",
    steps: "Steps",
    restingHeartRate: "Resting heart rate",
    hrv: "Heart rate variability",
    noData: "No data",
    noDataLower: "no data",
    noReadings: "No readings for this day.",
    empty: "Add charts to see biomarker readings here.",
    syntheticDemo: "Synthetic demo",
    dailyRange: "Daily range",
    nightlySummary: "Nightly summary",
    dailySummary: "Daily summary",
    lastObservation: "Last recorded at",
    cursor: "replay cursor",
    remove: (label: string) => `Remove ${label} chart`,
    focus: (label: string) => `Show anatomy for ${label}`,
    resetFocus: "Return to full-body view",
    stale: "Stale · last reading",
    band: "Derived reference band:",
    gaps: (count: number) => `${count} data ${count === 1 ? "gap" : "gaps"}`,
    to: "to",
    endOfDay: "end of day",
  },
  /** Picker details for each replay chart: category chip, source and one line on what it shows. */
  chartInfo: {
    heart_rate: {
      category: "Heart",
      provider: "Wearable import",
      description: "Beats per minute throughout the day.",
    },
    glucose: {
      category: "Glucose",
      provider: "Continuous glucose monitor",
      description: "Glucose readings from a continuous sensor.",
    },
    blood_glucose: {
      category: "Glucose",
      provider: "Blood glucose measurements",
      description: "Individual readings of glucose in blood.",
    },
    steps: {
      category: "Activity",
      provider: "Wearable import",
      description: "Step counts recorded throughout the day.",
    },
    resting_heart_rate: {
      category: "Heart",
      provider: "Wearable import",
      description: "The resting heart rate reported for the night.",
    },
    hrv_rmssd: {
      category: "Heart",
      provider: "Wearable import",
      description: "Nightly variation in the time between heartbeats, reported as RMSSD.",
    },
  },
  chartPicker: {
    open: "Add biomarkers",
    title: "Add biomarkers",
    selectedBadge: (count: number, max: number) => `${count}/${max} selected`,
    close: "Close biomarker picker",
    intro: (max: number) =>
      `Choose up to ${max} charts to personalise your daily replay.`,
    search: "Search biomarkers",
    category: "Biomarker category",
    allCategories: "All biomarkers",
    noMatches: "No biomarkers match your search.",
    unit: "Unit:",
    provider: "Provider:",
    noSeries: "This biomarker has no time series in Your Day replay.",
    full: "Remove a chart from the selection to free up a slot.",
    whyUnavailable: (label: string) => `Why is ${label} unavailable?`,
    availability: (label: string) => `${label} availability`,
    pages: "Biomarker results pages",
    firstPage: "Go to first page",
    previousPage: "Go to previous page",
    nextPage: "Go to next page",
    lastPage: "Go to last page",
    page: (number: number) => `Page ${number}`,
    showing: (first: number, last: number, total: number) =>
      `Showing ${first}–${last} of ${total} ${total === 1 ? "biomarker" : "biomarkers"}`,
    selected: (count: number, max: number) => `${count} of ${max} charts selected`,
    limitReached: "You’ve reached the chart limit.",
    remaining: (count: number) =>
      `You can add ${count} more ${count === 1 ? "biomarker" : "biomarkers"}.`,
    cancel: "Cancel",
    apply: "Apply selection",
    labProvider: "Lab result (Anchor catalogue)",
    wearableProvider: "Wearable measurement catalogue",
    wearableMeasure: "Wearable measurement.",
    replaySeries: "Time series in Day Replay.",
    sensorGlucose: "Glucose readings from a continuous sensor.",
    sleepIntervals: "Sleep intervals in Day Replay.",
    sleepOnTimeline: "Sleep is shown on the replay timeline, not as a chart.",
  },
  personal: {
    signIn: "Sign in to replay your data.",
    unlock: "Unlock your vault to replay your data.",
    noAccount: "No personal data account was found.",
    invalidQuery: "Choose a valid date to replay your data.",
    loadFailed: "Could not load your replay data. Try another date or reload the page.",
    heading: (zone: string) => `My Data · ${zone}`,
    sources: "Imported observations and the latest synced wearable records.",
    noReadings: "No imported or synced wearable readings for this date.",
    findingZone: "Finding your time zone…",
    importedSource: "Imported record",
    demoLabSource: "Synthetic demo lab",
  },
  viewer: {
    label: "Organ-level 3D reference anatomy",
    noWebgl: "The reference atlas needs WebGL.",
    contextLost: "The 3D view lost its WebGL context.",
    failed: "The reference atlas could not be loaded.",
    loading: "Loading reference atlas…",
  },
} as const;
