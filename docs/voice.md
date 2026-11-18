# Voice

Ask by speaking and hear the answer, with no network: speech to text in, text to speech
out, in English and German (#615, #616). The speech runs in a separate process on this
machine, the speech sidecar. The app talks to it over HTTP on loopback and never imports
it, so the engines behind it can change without touching the app.

Voice is off until `VOICE_SIDECAR_URL` is set. The address must be on this machine
(`localhost`, `127.0.0.1` or `[::1]`); anything else stops the app at startup, and the
client refuses it again before a request. A recording goes from the browser to the app and
from the app to the sidecar, and is never stored or logged on either side. The text it
turns into is a prompt like a typed one and follows the same rules
([providers.md](providers.md#what-leaves-the-host)).

| Setting                   | Default | Meaning                                             |
| ------------------------- | ------- | --------------------------------------------------- |
| `VOICE_SIDECAR_URL`       | unset   | The sidecar's root, such as `http://127.0.0.1:8095` |
| `VOICE_SIDECAR_TIMEOUT_S` | 30      | Longest wait for one transcript or one answer       |

## Contract

The types and limits live in `infrastructure/speech/contract.ts` and
`infrastructure/speech/wav.ts`; the client is `infrastructure/speech/sidecar-client.ts`.

### `GET /health`

```json
{
  "status": "ok",
  "stt": { "engine": "whisper.cpp", "model": "ggml-small-q5_1.bin" },
  "tts": {
    "engine": "piper",
    "voices": { "en": "en_GB-alba-medium", "de": "de_DE-thorsten-medium" }
  }
}
```

### `POST /v1/transcribe?language=en|de`

The body is a WAV file of 16-bit PCM, one channel, 16 kHz, at most 60 seconds
(`audio/wav`). The browser records, resamples and writes that shape; the app checks it
before sending. The language is the one the person picked, not a guess.

```json
{ "text": "Show me my heart.", "language": "en", "audioMs": 1820, "elapsedMs": 640 }
```

`audioMs` is the length of what was heard and `elapsedMs` the time the sidecar spent, so
each question records its own timings.

### `POST /v1/speak`

The body is `{ "text": "…", "language": "en" }`, at most 2,000 characters. The answer is
`audio/wav`, with the time spent in the `x-speech-elapsed-ms` header.

### Errors

Every error is `{ "error": { "message": "<plain sentence>", "type": "…" } }`, status 400
for a request the sidecar will not take and 500 for its own failure. The cause goes to the
sidecar's log only. The app logs status and body to the server log and shows one sentence
per code:

| Code                   | Shown                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| `SPEECH_OFF`           | Voice is not set up on this machine.                               |
| `SPEECH_NOT_LOCAL`     | Voice only runs on this machine, and its address points elsewhere. |
| `SPEECH_UNREACHABLE`   | The voice service is not running. Start it and try again.          |
| `SPEECH_TIMEOUT`       | The voice service took too long. Try a shorter question.           |
| `SPEECH_FAILED`        | The voice service could not handle that. Try again.                |
| `SPEECH_BAD_AUDIO`     | That recording could not be read. Try again.                       |
| `SPEECH_NOTHING_HEARD` | Nothing was heard. Hold the button while you speak.                |

## The app's routes

The browser never talks to the sidecar. It calls the app, which checks the request and
passes it on (`features/voice/`). All three need a signed-in person; the two that carry
speech sit behind the unlock gate like the chat.

| Route                                  | In                   | Out                                                        |
| -------------------------------------- | -------------------- | ---------------------------------------------------------- |
| `GET /api/voice/status`                | nothing              | `{ on, languages }`; `on` is false while voice is off      |
| `POST /api/voice/transcribe?language=` | the WAV              | `{ text, language, timings: { audioMs, sttMs, totalMs } }` |
| `POST /api/voice/speak`                | `{ text, language }` | `audio/wav`                                                |

`totalMs` is the whole request as the app saw it, so the three timings say how long the
person spoke, how long the sidecar took and what the route added. A failure is
`{ code, error }` with the sentence from the table above: 503 while voice is off or down,
504 on a timeout, 502 for the sidecar's own failure, 400 for a recording it cannot read and
422 when nothing was heard.

## Push to talk

When the sidecar answers, the chat's prompt bar shows a microphone button and the voice
language beside it (EN or DE, remembered in this browser; a German browser starts on DE).
Nothing about voice is drawn while it is off.

Hold the button, or hold Space or Enter on it, and speak; let go to send. A hold of 59
seconds sends itself, so it stays under the sidecar's limit, and leaving the page mid-hold
lets go of the microphone. The browser records with its own encoder, then decodes, mixes
down to one channel and resamples to 16 kHz before the upload (`infrastructure/speech/recorder.ts`), and lets go of the
microphone. The text goes out as a typed prompt would, on the models and mode the bar
shows; when it cannot (no model, a mode problem, answers still streaming) it waits in the
box. The hint line then says what took how long, such as "Heard 1.8s of German, written
down in 0.6s (0.7s in all)". A blocked or missing microphone, or a failure, is one
sentence beside the button.

## Tests

`infrastructure/speech/fake-speech-sidecar.ts` serves the same contract on `127.0.0.1`
with fixed sentences ("Show me my heart." and "Zeig mir mein Herz.") and a short tone, and
records what it received. Tests and screenshots use it; nothing in them needs a model.
