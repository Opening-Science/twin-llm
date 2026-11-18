import { voiceHandlers } from "@/features/voice/voice-runtime";

export const GET = (): Promise<Response> => voiceHandlers.status();
