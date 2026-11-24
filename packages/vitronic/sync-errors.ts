export class VitronicScannerHttpError extends Error {
  constructor(readonly status: number) {
    super("BodyLoop scanner returned an unsuccessful HTTP status.");
    this.name = "VitronicScannerHttpError";
  }
}

export class VitronicScanNotFoundError extends Error {
  constructor() {
    super("No matching BodyLoop scan was found.");
    this.name = "VitronicScanNotFoundError";
  }
}

export class VitronicScanKeyConflictError extends Error {
  constructor() {
    super("The saved scan key changed or the subject already has imported scans.");
    this.name = "VitronicScanKeyConflictError";
  }
}
