import { voiceHandlers } from "@/features/voice/voice-runtime";
import { withUnlocked } from "@/infrastructure/vault-runtime";

export const POST = withUnlocked((request: Request) => voiceHandlers.transcribe(request));
