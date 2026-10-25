import { findConnectionForUpload } from "@/features/vitronic/connection";
import { createVitronicUploadHandler } from "@/features/vitronic/upload-handler";
import { decryptVitronicSecret } from "@/features/vitronic/token-crypto";
import { vitronicEnv } from "@/infrastructure/env";

export const POST = createVitronicUploadHandler({
  vitronicEnv,
  findConnectionForUpload,
  decryptVitronicSecret,
});
