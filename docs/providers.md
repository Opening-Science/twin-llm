# LLM providers

TwinLLM sends the chat system prompt and user messages to exactly one configured provider (`LLM_PROVIDER`). Without `LOCAL_ONLY`, the default is `exoscale`: our own open models on an Exoscale GPU instance in Switzerland. `infomaniak` is legacy: it still works when named, but is never a default, and like OpenRouter and the remote GPU it gets synthetic data only, because no third-party model ever sees personal data. Tokens, encryption keys, FHIR bundles, and raw vendor wearable payloads never leave the host.

The open models TwinLLM will compare, with licence, tool calling and where each runs, are in [models.md](models.md).

The [data-flow diagram](diagrams/data-flow.svg) shows every source, store and tool, which services sit off this machine, and what is still planned.

## Local-only mode

`LOCAL_ONLY=true` keeps model calls, guideline embeddings, storage, analytics and auth on this machine. It is the recommended setting in `.env.example`.

With `LOCAL_ONLY=true`:

- `LLM_PROVIDER` defaults to `ollama`, and `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434/v1`) must be `localhost`, `127.0.0.0/8` or `[::1]`.
- Guideline embeddings refuse any origin that is not on this machine (`GUIDELINE_EMBED_ORIGIN_NOT_LOCAL`).
- The app refuses to start when any of these is set: `LLM_PROVIDER=exoscale`, `infomaniak`, `openrouter` or `remote-gpu` (a tunnel on loopback does not count: the model runs elsewhere), a non-loopback `OLLAMA_BASE_URL`, `GBD_MCP_URL`, `NEXT_PUBLIC_POSTHOG_KEY`, `ARCJET_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. It also needs `LOCAL_MVP=true` or `AUTH_DISABLED=true`.
- The footer says "Local only: models and storage run on this machine. Wearable syncs download from each vendor's cloud."

What local-only mode does not change:

- Oura, Whoop and Google Health syncs still call each vendor's API: the OAuth exchange and the data download go over the internet. Nothing from TwinLLM is uploaded to them.
- The BodyLoop scanner is reached on the local network, not the internet.
- Ark genome data stays on the device; TwinLLM only reads status.

Setup on this machine:

```bash
ollama pull qwen3:8b
ollama pull nomic-embed-text
bunx next telemetry disable
```

`qwen3:8b` is an open-weight model under Apache-2.0 with tool calling, about 5 GB on disk; it needs roughly 8 GB of free memory. `qwen3:4b` is a smaller option for 8 GB machines. Any chat model that `ollama list` shows can be used; embedding-only models are left out of the model picker.

`bun run dev` and `bun run start` bind Next.js to `127.0.0.1`. With auth off (`LOCAL_MVP` / `AUTH_DISABLED`) the app also refuses requests whose Host is not loopback and cross-site form or fetch posts, and will not start under `NODE_ENV=production` unless `ALLOW_AUTH_DISABLED_IN_PRODUCTION=true`. To serve other machines, turn sign-in on. Postgres should be published the same way (`-p 127.0.0.1:5432:5432`, see [guidelines.md](guidelines.md)).

## Exoscale

`LLM_PROVIDER=exoscale` sends chat to vLLM servers we run on an Exoscale GPU instance in Switzerland. The card depends on availability; the sizing below was planned for an A30 large instance (3× A30, 24 GB each). Exoscale lists the A30 in CH-GVA-2; our zone is to be confirmed. Which models fit, and their vLLM tool parsers, are in [models.md](models.md#where-they-run). No Exoscale instance exists yet, so nothing here has been run live.

**One vLLM per GPU.** Three GPUs serve three models side by side, each on its own port, for example:

```bash
CUDA_VISIBLE_DEVICES=0 vllm serve Qwen/Qwen3-8B --port 8000 --api-key "$VLLM_API_KEY" \
  --enable-auto-tool-choice --tool-call-parser hermes
CUDA_VISIBLE_DEVICES=1 vllm serve swiss-ai/Apertus-8B-Instruct-2509 --port 8001 --api-key "$VLLM_API_KEY" \
  --enable-auto-tool-choice --tool-call-parser apertus
```

**Env** (names only; values stay in `.env.local`):

- `EXOSCALE_BASE_URLS`: comma list, one URL per vLLM server, each ending in `/v1`. `https://` is required. A user name, password, query or hash is refused, and so is any entry that is also in `REMOTE_GPU_BASE_URLS` (compared without case or trailing slashes), so personal data can never reach a rented GPU under the exoscale label. The startup error names the entry by position, never by value.
- `EXOSCALE_ALLOW_LOOPBACK_TUNNEL`: `false` by default. Set it to `true` only for an SSH tunnel to our own Exoscale VM; then plain `http://` is accepted on loopback (`127.0.0.0/8`, `localhost`, `[::1]`). A host such as `localhost.example.com` is not loopback.
- `EXOSCALE_API_KEY`: the `--api-key` the servers were started with, if any. Sent as a bearer token, never logged.
- `EXOSCALE_PERSONAL_DATA`: `off` (default) or `consented-pilot`. See **Data policy** below.
- `EXOSCALE_FIRST_BYTE_TIMEOUT_S`: how long a call may wait for the first byte of the answer (default 120). A call that times out fails once and is not retried; once the answer has started, it may take as long as it needs.
- `LOCAL_ONLY=false`. With `LOCAL_ONLY=false` and no `LLM_PROVIDER`, exoscale is the default, and the app refuses to start without `EXOSCALE_BASE_URLS` instead of falling back to another cloud.

**Models.** The picker lists `GET {url}/models` from every URL each time the catalog loads, labelled "Exoscale (Switzerland)", and sends each model id to the URL that listed it. A server that does not answer within 5 s is skipped (`[model-catalog] exoscale skipped <host> <reason>`); the others still list. There is no static fallback.

**Data policy.** Personal data goes only to local Ollama, or to Exoscale only with `EXOSCALE_PERSONAL_DATA=consented-pilot`. We run the servers and the models, but Exoscale operates the hardware and can technically read the memory of a running instance, so until confidential computing ships the instance sees synthetic data, or personal data from a pilot whose participants consented.

- `EXOSCALE_PERSONAL_DATA=off` (the default): a personal request (`DATA_MODE=personal`, or a request with a wearable snapshot) to Exoscale is refused with `PROVIDER_NOT_PERMITTED_FOR_DATA_MODE`. `DATA_MODE=personal` with `LLM_PROVIDER=exoscale`, including Exoscale as the default with `LOCAL_ONLY=false`, stops the app at startup.
- `EXOSCALE_PERSONAL_DATA=consented-pilot`: personal requests are allowed. Each one, from chat or the onboarding starter questions, writes a `provider.personal_data_sent` event to the audit chain (provider and model id, hashed as usual; no prompt or answer) before the model is called.

The instance is still off this machine, so `LOCAL_ONLY=true` refuses it at startup, even through a tunnel on loopback.

## Tool calls by model

Run 2026-10-16 on a MacBook Air M1, 8 GB, Ollama defaults (4096-token context, before [#149](#ollama-context)), `LOCAL_ONLY=true`, `DATA_MODE=synthetic`, cohort `synthea-v4-seed42`. One prompt asks for the latest heart rate (LOINC `8867-4`) of one listed subject; the test passes when the audit log has at least one tool call for that model's session. Command: see the header of `features/chat/tool-calls.live.test.ts` (`RUN_LIVE=1` only, never CI).

| Model      | Made a tool call | Notes                                                                                                                                      |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `qwen3:4b` | yes              | `latest_by_loinc`, 1 row, 246 s.                                                                                                           |
| `qwen3:8b` | no               | Stream ended with no output after 357 s (`AI_NoOutputGeneratedError`). Ran 20% on CPU at about 0.3 tokens/s on this machine; inconclusive. |

Re-run on a machine with 16 GB or more before reading the `qwen3:8b` row as a model limit.

Remote GPU (`LLM_PROVIDER=remote-gpu`, Apertus on vLLM, same prompt and cohort): not yet run. On 2026-10-17 the SSH tunnel connected, but vLLM was not listening on the pod's ports after a restart. Rows follow when the pod serves again, with the model ids its `/v1/models` lists.

| Model                | Made a tool call | Notes                                        |
| -------------------- | ---------------- | -------------------------------------------- |
| Apertus (remote GPU) | not yet run      | vLLM not serving on 2026-10-17; see runbook. |

## What leaves the host

| Provider                                    | When it may run                                                                                                                               | What is sent                                                                                                                                                                                                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **exoscale** (default without `LOCAL_ONLY`) | `DATA_MODE=synthetic` with no wearable snapshot; personal data only with `EXOSCALE_PERSONAL_DATA=consented-pilot`; not with `LOCAL_ONLY=true` | System prompt + messages to our own vLLM servers on the Exoscale instance in Switzerland. Under the consented pilot, wearable _summaries_ (narrative + citation keys) and BodyLoop measurements are included when a snapshot exists, and each such request is audited. |
| **infomaniak** (legacy, only when named)    | Same as openrouter: synthetic only, no wearable snapshot, not with `LOCAL_ONLY=true`                                                          | System prompt + messages to Infomaniak's OpenAI-compatible API in Switzerland, a third party. `DATA_MODE=personal` stops the app at startup, and a request with a wearable snapshot is a typed 400.                                                                    |
| **ollama** (default with `LOCAL_ONLY`)      | Always allowed; loopback only with `LOCAL_ONLY=true`                                                                                          | The same prompt payload to `OLLAMA_BASE_URL` (local Mac daemon or, without `LOCAL_ONLY`, a remote OpenAI-compatible server).                                                                                                                                           |
| **openrouter**                              | Only `DATA_MODE=synthetic` **and** no wearable snapshot on the request, and not with `LOCAL_ONLY=true`                                        | System prompt + messages to OpenRouter. A stored Oura, Whoop, or Google Health snapshot makes this a typed 400 (`PROVIDER_NOT_PERMITTED_FOR_DATA_MODE`).                                                                                                               |
| **remote-gpu**                              | Same as openrouter: synthetic only, no wearable snapshot, not with `LOCAL_ONLY=true`                                                          | System prompt + messages + synthetic tool results to a vLLM server on a rented GPU, through an SSH tunnel on `127.0.0.1`. The pod's provider (RunPod) is a third party.                                                                                                |

`resolveLanguageModel` applies the same `permitProviderForRequest` check as the chat route (defence in depth).

`DATA_MODE=personal` (the default) forbids OpenRouter, Infomaniak and remote-gpu at env parse and at the chat route, and Exoscale unless `EXOSCALE_PERSONAL_DATA=consented-pilot`. Any other value, including the old `demo` and `real`, fails at startup.

MCP servers follow the same rule by locality: `permitServerForDataMode` in `packages/mcp-client/policy.ts` allows a `local` server in both modes and a `remote` one only with `DATA_MODE=synthetic`. The registry lists each server with its locality; see [`gbd.md`](gbd.md).

The first-run starter questions go to the same provider, through the same `permitProviderForRequest` check, from the first model of the default selection. The prompt holds the chosen roles, the data choice, the names of linked sources (no values) and what the person typed. With a linked source, OpenRouter, Infomaniak and the remote GPU refuse the call, as does Exoscale without the consented pilot, and fixed starters are shown. A personal starter request to Exoscale under the consented pilot writes the same `provider.personal_data_sent` audit event before the model call; if that write fails, the model is not called and fixed starters are shown.

## What never leaves

- Access / refresh tokens and OAuth codes
- `fhirBundle` JSON (stays on the configured store)
- Raw vendor API bodies
- Cookie and state values

Chat injects only the summary narrative and `whoop.*` / Oura / Google Health citation keys.

## Ollama context

Ollama loads a model with a 4096-token context unless the request asks for more, and drops the start of a longer prompt without an error (its log says `truncated = 1`). The tool definitions come first, so the model loses them and writes tool calls as text (#149). The OpenAI-compatible endpoint (`/v1/chat/completions`) ignores `num_ctx`, so chat with `LLM_PROVIDER=ollama` uses Ollama's native `/api/chat` with `options.num_ctx` set to `OLLAMA_NUM_CTX` (default `16384`). Nothing changes on the Ollama service: no `OLLAMA_CONTEXT_LENGTH`, no Modelfile variants. The model list and embeddings still use `OLLAMA_BASE_URL` as before. Thinking is off on this path (`think: false`): the fine-tuned models have no thinking mode, and the answer already has a written Reasoning section.

`bun run doctor` (and the end of `bun run setup:local`) prints the context chat asks for and the context each loaded model runs at (`/api/ps`), and says when part of a model runs on the CPU.

**Size of the prompt.** `bun run prompt:size --ollama qwen3:4b` renders the system prompt and model-facing tool list of a first turn for each data mode and skill and prints Ollama's exact token count. Measured 2026-10-27 with `qwen3:4b`:

| Turn                            | Tools | Tokens |
| ------------------------------- | ----- | ------ |
| synthetic                       | 20    | 4,666  |
| synthetic `/sleep`              | 9     | 2,860  |
| personal, no wearable           | 21    | 4,541  |
| personal, no wearable `/genome` | 2     | 1,120  |
| personal, Oura linked           | 21    | 9,088  |
| personal, Oura linked `/sleep`  | 9     | 7,257  |
| personal, all four wearables    | 21    | 20,262 |

A linked wearable costs about 4,500 tokens, because the prompt lists each source's metrics twice (narrative lines and the key list) and Qwen3 spends one token per digit of every date and value. With all four linked the prompt alone is larger than 16k; set `OLLAMA_NUM_CTX=32768` for that case. `scripts/setup/prompt-size.test.ts` fails when any other case leaves less than 4,096 tokens for the conversation, the tool results and the answer at the default context.

**Memory.** The KV cache grows with the context. Measured on an RTX 2080 Ti (11 GB) with the desktop holding about 4.4 GB, Ollama 0.33.3:

| Model                     | 4096    | 8192                 | 16384                | 32768                |
| ------------------------- | ------- | -------------------- | -------------------- | -------------------- |
| `qwen3:4b`, fine-tuned 4B | 3.0 GiB | 3.6 GiB              | 4.8 GiB              | 7.1 GiB (5.3 on GPU) |
| `qwen3:8b`                | 5.2 GiB | 6.1 GiB (5.3 on GPU) | 7.3 GiB (5.2 on GPU) | 9.7 GiB (5.2 on GPU) |

At 16384 the 4B models fit on the GPU with room to spare. `qwen3:8b` needs 7.3 GiB at 16384: whole on an 11 GB card with a light desktop, partly on the CPU (slower) when the desktop takes 4 GB. On a Mac the same sizes come out of unified memory, so an 8 GB machine should stay on a 4B model.

## How to switch

Set `LLM_PROVIDER` to `exoscale`, `ollama`, `openrouter`, `remote-gpu` or (legacy) `infomaniak` in `.env.local`. Names only; values stay in `.env.local`.

- Exoscale: `EXOSCALE_BASE_URLS`, optional `EXOSCALE_API_KEY` and `EXOSCALE_FIRST_BYTE_TIMEOUT_S`, `LOCAL_ONLY=false`. See [Exoscale](#exoscale).
- Infomaniak (legacy): `INFOMANIAK_API_TOKEN`, `INFOMANIAK_PRODUCT_ID`, optional `INFOMANIAK_BASE_URL` (default already ends in `/openai/v1`). Catalog is `GET {that base}/models`, not `{base}/v1/models`.
- Ollama: `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434/v1`), optional `OLLAMA_NUM_CTX` (default `16384`). See [Ollama context](#ollama-context).
- OpenRouter: `OPENROUTER_API_KEY`, and `DATA_MODE=synthetic` with no linked snapshot.
- Remote GPU: `REMOTE_GPU_BASE_URLS`, a comma list of loopback tunnel URLs ending in `/v1` (one per vLLM port), optional `REMOTE_GPU_API_KEY` (vLLM `--api-key`), `DATA_MODE=synthetic` and `LOCAL_ONLY=false`. The catalog merges `GET {url}/models` from every URL and sends each model to the URL that listed it; a closed tunnel is skipped. Setup: [runbook](runbook.md#remote-gpu-runpod-ssh-tunnel).

## Provider failure logging

When the chat route catches a failure while starting a model stream, it logs
`[chat] failed to start the model stream` and a summary containing `code` plus
an optional integer HTTP `status` from 100 to 599. The allowed code is
`insufficient_quota`; every other code becomes `other`. This log does not
include error names, messages, types, URLs, request data, or response bodies.
The client still receives the existing fixed retry message.

An unsuccessful Infomaniak catalogue HTTP response logs
`[model-catalog] infomaniak allowlist source=static` and its numeric status.
These statements describe those two log sites, not all application logging.

## MedGemma

MedGemma is **not** an Infomaniak managed model id. Run it on our own servers:

- Mac: `LLM_PROVIDER=ollama` and `OLLAMA_BASE_URL=http://127.0.0.1:11434/v1` after `ollama pull` of the local tag.
- Exoscale: serve it with vLLM on one of the GPUs and add that server's URL to `EXOSCALE_BASE_URLS` (`LLM_PROVIDER=exoscale`). It has no native tool calling (see [models.md](models.md)).

## Response document

Every streamed chat completion carries JSON metadata `intended_use=research_hypothesis_generation_n_of_1` and `not_for_diagnostic_use=true`. That field is protocol metadata, not user-facing copy (C4).
