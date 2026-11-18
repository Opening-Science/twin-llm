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

## Set up and start the sidecar

The sidecar is `scripts/voice/serve.ts` over two engines that run as child processes on
the CPU: [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT) for speech to text
and [Piper](https://github.com/OHF-Voice/piper1-gpl) (GPL-3.0, run as a separate program,
never linked) for text to speech. Nothing is downloaded until you run the setup yourself:

```sh
bun run voice:setup  # asks before it downloads about 400 MB
bun run voice:serve  # http://127.0.0.1:8095
```

Then set `VOICE_SIDECAR_URL=http://127.0.0.1:8095` in `.env.local` and restart the app.
`bun run doctor` then has a Voice section: whether the engines are set up, whether the URL
is set and on this machine, and whether the sidecar answers with its engines and voices.

`voice:setup` writes into `~/.local/share/twinllm-voice` (`--home` or `VOICE_HOME` to
change it) and needs git, cmake, a C++ compiler, curl and uv. Everything it fetches is
pinned, and a file that does not match is deleted and the setup stops:

| Part          | Pin                                                                         | Licence   |
| ------------- | --------------------------------------------------------------------------- | --------- |
| whisper.cpp   | v1.9.5, commit `d1be6fde`, built with `GGML_CUDA=OFF`                       | MIT       |
| Speech model  | `ggml-small-q5_1.bin` (190 MB), SHA-256; `--model base` for the 60 MB model | MIT       |
| Piper         | `piper-tts==1.8.0` in its own Python environment                            | GPL-3.0   |
| English voice | `en_GB-alba-medium` at piper-voices `0ca208af`, SHA-256                     | CC BY 4.0 |
| German voice  | `de_DE-thorsten-medium` at piper-voices `0ca208af`, SHA-256                 | CC0       |

The small model is the default because the base model's German is noticeably weaker. The
threads are the machine's cores, at most eight.

`voice:serve` listens on 127.0.0.1 only; the host is fixed and only `--port` changes. Each
request gets its own folder under the setup's `work/` for its audio, removed when the
request ends. The log has the call, the language and the timings, never the text or the
audio.

## Timings

`bun run voice:time` times the sidecar on this machine for the kiosk trial (#615). For two
fixed sentences per language it asks the sidecar to speak the sentence, turns Piper's WAV
into the 16 kHz input shape and asks the sidecar to write it down again, so it needs no
microphone and keeps no recording. It prints one line per sentence and appends the same
to `timings.jsonl` in the setup's folder (`--out` to change it):

```text
de  speak 410 ms  heard 1650 ms of audio in 720 ms  total 1190 ms  "Zeig mir mein Herz."
```

`speak` and `heard … in` are the sidecar's own times, `total` the whole round trip, and
the quoted text is what speech to text heard of the spoken sentence, a quick check of both
engines and the voice. It talks only to a sidecar on loopback (`--url`, default
`http://127.0.0.1:8095`). The numbers above are an example of the format, not a
measurement.

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

## Reading answers aloud

The answer to a spoken question is read back once it is finished, in the language it was
asked in: the first finished answer of that turn with words to say, once. One that failed,
was stopped or is withheld is not read. Every other finished answer gets a Read aloud
button while voice is on, in the language picked on the prompt bar; pressed again it
stops. One answer plays at a time.

What is read is the answer's Answer section as words (`infrastructure/speech/spoken-text.ts`):
code, tables, images, web addresses and bracketed citation ids are left out, a link keeps
its words, and a heading or list item ends as a sentence. The text goes to
`/api/voice/speak` in pieces of whole sentences of up to 400 characters, so the first
plays while the next is made, and nothing is kept once it has played. A spoken turn is
known only to the open page; a reloaded thread is not read back on its own.

## Tests

`infrastructure/speech/fake-speech-sidecar.ts` serves the same contract on `127.0.0.1`
with fixed sentences ("Show me my heart." and "Zeig mir mein Herz.") and a short tone, and
records what it received. Tests and screenshots use it; nothing in them needs a model. The
sidecar itself is tested with stand-in engines (`scripts/voice/speech-sidecar.test.ts`)
and with shell scripts in place of `whisper-cli` and `piper` (`scripts/voice/engines.test.ts`).
