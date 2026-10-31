import { getArkStatusResponse } from "@/features/connectors/ark-status";
import { withUnlocked } from "@/infrastructure/vault-runtime";

export const GET = withUnlocked((): Promise<Response> => getArkStatusResponse());
