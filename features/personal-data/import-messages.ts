/**
 * Sentences the import screens show. Plain, no codes, never an exception's
 * text: the server logs the cause and the person reads one of these.
 */
export const IMPORT_MESSAGES = {
  signIn: "Sign in to import your data.",
  syntheticMode:
    "Importing your own data is off while TwinLLM runs on synthetic data (DATA_MODE=synthetic).",
  noFile: "Choose a file to import.",
  noKind: "Choose what kind of file this is.",
  tooLarge: "The file is larger than 50 MB.",
  unreadableUpload: "The upload could not be read. Try again.",
  changedSinceReview:
    "The file is not the one you reviewed. Review it again before saving.",
  duplicate: "You already imported this file.",
  nothingToStore: "Nothing in this file can be stored, so there is nothing to save.",
  saveFailed: "The import could not be saved. Nothing was stored; try again.",
  notFound: "That dataset is not there any more.",
  badName: "Give the dataset a name.",
  failed: "Something went wrong. Try again.",
} as const;
