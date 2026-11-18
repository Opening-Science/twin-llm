import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { ROUND_TRIP_SENTENCES, roundTrip } from "./round-trip";

/** `bun run voice:time` (docs/voice.md): the round trip in `round-trip.ts`, run and recorded. */

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:8095" },
    out: {
      type: "string",
      default: join(homedir(), ".local/share/twinllm-voice/timings.jsonl"),
    },
  },
});
const url = values.url.replace(/\/+$/, "");
if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(url)) {
  console.error("voice:time only talks to a sidecar on this machine");
  process.exit(2);
}
mkdirSync(dirname(values.out), { recursive: true });
const at = new Date().toISOString();
for (const language of ["en", "de"] as const) {
  for (const sentence of ROUND_TRIP_SENTENCES[language]) {
    const result = await roundTrip(url, language, sentence);
    appendFileSync(values.out, `${JSON.stringify({ at, ...result })}\n`);
    console.log(
      `${language}  speak ${result.speakMs} ms  heard ${result.audioMs} ms of audio in ${result.sttMs} ms  total ${result.totalMs} ms  "${result.heard}"`,
    );
  }
}
console.log(`appended to ${values.out}`);
