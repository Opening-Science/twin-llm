# Carbon-X sidecar

Research spike for #58. [Carbon-X](https://huggingface.co/HuggingFaceBio/Carbon-X) is a
14.8B DNA-and-text model (Apache-2.0, base Qwen3-14B) from Hugging Face Bio. It reads DNA
inside a chat message and answers in English. It is research software: not clinically
validated, not for medical decisions, and weak on splice sites by its own card (29.8 % on
GenomeQA splice questions). TwinLLM does not call it yet; this page fixes the contract a
later `dna_ask` tool would use.

## Where it runs

A separate Python process (`python/carbon/serve.py`, `carbon` dependency group), never
imported by the app. It listens on **127.0.0.1:8090 only**; the host is hard-coded. It loads
a pinned local snapshot with no network at run time. Genomes and windows cut from them stay
on the machine.

| Item           | Value                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| Revision       | `539ad36790e78a38718c547bcb12c55b8a447c56` (2026-10-23)                  |
| Weights        | safetensors only, outside the repository (`~/Projects/carbon-x/model`)   |
| Quantisation   | bitsandbytes NF4, double quant, fp16 compute (Turing has no bf16)        |
| Context        | 4,096 tokens by default (`--max-context`); one DNA token is 6 bases      |
| Base tokenizer | `Qwen/Qwen3-4B-Base` at `906bfd4b…`, fetched once into a private HF_HOME |

The model's `tokenizer.py` is the only remote code `trust_remote_code` runs. It was read
in full before first use: no eval, exec, subprocess, socket or pickle. Its one network
call fetches the pinned Qwen3 base tokenizer; the sidecar pre-fetches those files and runs
with `HF_HUB_OFFLINE=1` and `local_files_only`. Review any new revision the same way before
moving the pin.

### Memory on an 11 GB card

On the RTX 2080 Ti that also drives the desktop, about 6.8 GB is free. The NF4 decoder
needs about 6.6 GB on its own, so the sidecar keeps as many decoder layers on the GPU as
fit and leaves the rest in pinned host RAM as packed 4-bit weights (164 MiB per layer),
copying each one in for its forward pass. The token embedding stays on the CPU. This is
CPU offload and it costs decode speed; `GET /health` reports the split.

## Start and stop

```sh
cd python
uv sync --group carbon
uv run --group carbon carbon/serve.py \
  --model-dir ~/Projects/carbon-x/model \
  --revision 539ad36790e78a38718c547bcb12c55b8a447c56 \
  --hf-home ~/Projects/carbon-x/hf-home
```

Free the GPU first: unload Ollama models (`keep_alive: 0`) and stop the sidecar when done.
Loading takes about a minute from the page cache (bf16 to NF4 on the fly).

## Contract

All bodies are JSON. Errors are `{"error": {"message": "<plain sentence>", "type": "…"}}`;
the message is safe to show, the cause goes to the sidecar's log only. The sidecar never
logs request or response bodies, only an id, token counts, latency and VRAM.

### `GET /health`

```json
{
  "status": "ok",
  "model": "carbon-x",
  "revision": "539ad36790e78a38718c547bcb12c55b8a447c56",
  "quantization": "bitsandbytes nf4, fp16 compute",
  "max_context": 4096,
  "layers_on_gpu": 24,
  "layers_streamed_from_host": 16,
  "vram": {
    "allocated_bytes": 4629514240,
    "reserved_bytes": 5244977152,
    "device_free_bytes": 1477640192,
    "device_total_bytes": 11352539136
  },
  "device": "NVIDIA GeForce RTX 2080 Ti"
}
```

### `GET /v1/models`

`{"object": "list", "data": [{"id": "carbon-x", "object": "model", "owned_by": "local"}]}`

### `POST /v1/chat/completions`

OpenAI-compatible, non-streaming. Model id `carbon-x`.

| Field                                  | Default | Notes                                                 |
| -------------------------------------- | ------- | ----------------------------------------------------- |
| `messages`                             | —       | `system`, `user`, `assistant`; the last one is `user` |
| `max_tokens`                           | 1024    | prompt + `max_tokens` must fit `max_context`          |
| `temperature`                          | 0.6     | `0` is greedy decoding, deterministic                 |
| `top_p`, `top_k`                       | 0.95,20 | the model card's sampling defaults                    |
| `seed`                                 | none    | fixes sampling                                        |
| `chat_template_kwargs.enable_thinking` | false   | Carbon-X was trained and evaluated with thinking off  |

`stream`, `tools` and `n > 1` are refused with 400. A prompt that does not fit is 400
`context_length_exceeded` with the token count in the message.

Response: the usual `id`, `object: "chat.completion"`, `created`, `model`, one `choices[0]`
with `message.content` and `finish_reason` (`stop` or `length`), and `usage`. One extra
object:

```json
"carbon": { "revision": "539ad367…", "latency_ms": 29900, "peak_vram_bytes": 5391572480 }
```

Put DNA in the user message, ideally as `name: <dna>ACGT…</dna>`, with the facts worked
out in code first (coordinates, strand, reference and alternate base, position in the
window). That is the model card's `ask_carbon` shape.

### `POST /v1/dna/log-likelihood`

`{"dna": "ACGT…"}` returns the summed log-likelihood (nats) of the DNA tokens of
`<dna>…</dna>`, the quantity behind the model card's `compare` skill:

```json
{
  "object": "dna.log_likelihood",
  "model": "carbon-x",
  "log_likelihood": -5321.7,
  "dna_tokens": 683,
  "usage": { "prompt_tokens": 685 },
  "carbon": { "revision": "539ad367…", "latency_ms": 2300, "peak_vram_bytes": 5061881856 }
}
```

Only A, C, G and T are accepted. Compare equal-length reference and alternate windows; the
difference is a likelihood, not a pathogenicity score.

## A `dna_ask` tool for TwinLLM (not built)

If TwinLLM adopts this, the tool should follow the model card's agent advice: the chat
model names a variant or region, and server code cuts the windows from the owner's genome
(Ark) and the public reference, computes coordinates, strand and alleles, and sends them
as context. The chat model never pastes DNA. Answers are labelled as model predictions.
DNA goes only to 127.0.0.1.

## Measured on the RTX 2080 Ti

One overnight run on 2026-10-27, public reference sequence and public ClinVar / CPIC
variants only, greedy decoding. The full report stays outside the repository with the
weights (`~/Projects/carbon-x/REPORT.md`).

| Call                                               | Prompt tokens | Latency, median (max) | Peak VRAM (torch) |
| -------------------------------------------------- | ------------- | --------------------- | ----------------- |
| Short card example                                 | ~60           | 24 s (32 s)           | 4.7 GiB           |
| Variant question, 2 × 4,096 bp, ~100 answer tokens | ~1,480        | 30 s (39 s)           | 5.0 GiB           |
| Variant question, 2 × 8,192 bp (largest that fits) | 2,865         | 17 s for 54 tokens    | 5.4 GiB           |
| Log-likelihood of one 4,096 bp window              | 685           | ~2.3 s                | 4.7 GiB           |

Load takes about 60 s. Decode runs at about 3.5 tokens/s because 16 of 40 layers stream
from host RAM; prefill takes a few seconds. The sidecar holds about 6 GB of VRAM, 1.5 GB
of process memory and 2.6 GiB of pinned host RAM.

What it got right and wrong, in short: on 26 ClinVar SNVs (13 pathogenic, 13 benign,
sequence-only prompts) the chat verdict was right for 20 (77 %, Wilson 95 % CI 58–89 %),
against 13 (50 %) for `qwen3:8b`, which answered "benign" every time. The log-likelihood
difference separated the two groups better (AUROC 0.93). It missed the NF1 c.6007-2A>G
splice acceptor unless the HGVS position was given, and it misdescribed the mechanism of
10 of the 11 pharmacogenomic panel variants when given no transcript annotation. Use it,
if at all, with coordinates, transcript position and alleles computed in code, and show
its answers as model predictions.
