/**
 * What Customize · Data says about a GBD import (#426): short plain
 * sentences, never an exception or a server message.
 */
export const GBD_IMPORT_MESSAGES = {
  notLocal:
    "GBD files are imported on a local install only (LOCAL_MVP or AUTH_DISABLED), because every person using this server shares the GBD store.",
  signIn: "Sign in to import GBD files.",
  otherSite: "Import GBD files from Customize · Data.",
  notCsv: "Choose the CSV files of a GBD Results Tool download.",
  tooLarge:
    "This file is larger than 1 GB. Download a narrower query from the GBD Results Tool, or import it with bun run gbd:import.",
  noSpace:
    "There is not enough free disk space for this file: the import keeps 1 GB free in the state folder. Free some space and try again.",
  empty: "This file is empty.",
  incomplete: "The file did not arrive whole. Try again.",
  failed: "The import did not finish. Nothing from this file was kept. Try again.",
  notFound: "This GBD file is no longer imported.",
  deleteFailed: "The GBD file could not be deleted just now. Try again.",
  citationOnly:
    "citation.txt holds the citation only. Choose it together with the CSV files of the same download.",
} as const;
