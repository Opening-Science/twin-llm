export const PRIVACY_COPY = {
  synthetic:
    "This install holds synthetic data only, so there is nothing to consent to. Synthetic cohorts never need consent.",
  signIn: "Sign in to manage consent.",
  noSources: "Choose at least one kind of data first.",
  alreadyGranted: "This use is already on. Withdraw it first to change what it covers.",
  unknownScope: "That use does not exist. Reload the page.",
  granted: "Granted. Pipelines may now use the data you chose for this.",
  withdrawn: "Withdrawn. No future run may use your data for this.",
  notActive: "This consent was already withdrawn.",
  failed: "The change was not saved. Try again.",
  withdrawHold: "Hold to withdraw consent",
  withdrawing: "Withdrawing…",
} as const;
