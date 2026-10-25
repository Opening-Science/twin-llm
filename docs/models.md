# Open-model lineup

Which open models TwinLLM will compare, and what we know about each before running
them. Checked against the model cards and vendor pages on 2026-10-23; see
[Sources](#sources).

## Purpose

TwinLLM compares open models on its synthetic data (Synthea cohort
`synthea-v4-seed42`) through the same closed, audited query tools. The baseline is Qwen 3
(`qwen3:4b` and `qwen3:8b` on Ollama).

Tool calling is required. Before a model joins the comparison it runs
`features/chat/tool-calls.live.test.ts` (`RUN_LIVE=1`, never CI), and the result goes
into the "Tool calls by model" table in [providers.md](providers.md). A model that makes
no tool call is reported as such. It is never worked around silently (no hidden
prompt-only fallback, no pre-fetched data).

## Lineup

"Tool calling" means: **native** (the model card or vLLM documents it, with the vLLM
parser), **not verified** (the chat template has a tools section, but nobody documents
or has tested it for this model), **none** (no tools section in the template). None of
these has been run through the live test yet, except `qwen3:4b` (see
[providers.md](providers.md)).

| Model                                      | Size  | Base                      | Licence          | Where it runs                                                        | Tool calling                                                                                  | Context | 8 GB laptop | One A30 (24 GB)                 | Reported medical scores (model card)             |
| ------------------------------------------ | ----- | ------------------------- | ---------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------- | ----------- | ------------------------------- | ------------------------------------------------ |
| Qwen3-4B                                   | 4.0B  | Qwen3-4B-Base             | Apache-2.0       | Ollama `qwen3:4b` (2.5 GB); vLLM                                     | native, `hermes`                                                                              | 32K     | yes         | yes                             | none on card                                     |
| Qwen3-8B                                   | 8.2B  | Qwen3-8B-Base             | Apache-2.0       | Ollama `qwen3:8b` (5.2 GB); vLLM                                     | native, `hermes`                                                                              | 32K     | tight       | yes (BF16)                      | none on card                                     |
| MedGemma 1.5 4B (`medgemma-1.5-4b-it`)     | 4B    | Gemma 3                   | HAI-DEF          | Ollama `medgemma:4b` (3.3 GB); vLLM                                  | not verified (card does not mention it; no vLLM parser)                                       | 128K    | yes         | yes                             | MedQA 69.1, MedMCQA 59.8, PubMedQA 68.2          |
| MedGemma 27B text (`medgemma-27b-text-it`) | 27B   | gemma-3-27b-pt            | HAI-DEF          | GGUF Q4_K_M (16.6 GB); Ollama `medgemma:27b` is the image+text model | not verified (card does not mention it; no vLLM parser)                                       | 128K    | no          | 4-bit only                      | MedQA 87.7 (0-shot), MedMCQA 74.2, PubMedQA 76.8 |
| Apertus-8B-MeditronFO (EPFLiGHT)           | 8.1B  | Apertus-8B-Instruct-2509  | Apache-2.0       | vLLM; community GGUF Q4_K_M (5.1 GB)                                 | not verified: keeps the Apertus tool template, untested after the fine-tune; parser `apertus` | 64K     | tight (Q4)  | yes (BF16)                      | MedQA 60.7, MedMCQA 52.0, HealthBench 42.1       |
| Apertus-70B-MeditronFO (EPFLiGHT)          | 70.6B | Apertus-70B-Instruct-2509 | Apache-2.0       | vLLM, multi-GPU                                                      | not verified, as above; parser `apertus`                                                      | 64K     | no          | no                              | MedQA 71.1, MedMCQA 60.2, HealthBench 49.3       |
| Meditron3-Qwen2.5-7B (EPFLiGHT)            | 7.6B  | Qwen2.5-7B                | Apache-2.0       | vLLM; community GGUF Q4_K_M (4.7 GB)                                 | not verified (Qwen2.5 template has tools; `hermes` likely)                                    | 32K     | tight (Q4)  | yes (BF16)                      | MedQA 62.7, MedMCQA 55.6, PubMedQA 73.6          |
| HuatuoGPT-o1-7B                            | 7.6B  | Qwen2.5-7B-Instruct       | Apache-2.0       | vLLM; community GGUF Q4_K_M (4.7 GB)                                 | not verified (Qwen2.5 template has tools; `hermes` likely)                                    | 32K     | tight (Q4)  | yes (BF16)                      | none on card                                     |
| II-Medical-8B                              | 8.2B  | Qwen3-8B                  | Apache-2.0       | vLLM; community GGUF                                                 | none (no tools section in its chat template)                                                  | 40K     | tight (Q4)  | yes (BF16)                      | MedQA 87.8, HealthBench 40                       |
| Baichuan-M2-32B                            | 32.8B | Qwen2.5-32B               | Apache-2.0       | vLLM 0.9.0+ or SGLang; GPTQ 4-bit version                            | not verified (template has tools; card does not mention it)                                   | 128K    | no          | 4-bit only (card: one RTX 4090) | HealthBench 60.1, HealthBench-Hard 34.7          |
| Apertus-8B-Instruct-2509 (Swiss AI)        | 8.1B  | Apertus-8B-2509           | Apache-2.0       | vLLM                                                                 | native, `apertus`                                                                             | 64K     | not planned | yes (BF16)                      | none on card                                     |
| Apertus-v1.5-8B (Swiss AI)                 | 8B    | Apertus 1.0 (continued)   | Apache-2.0 + AUP | Swiss AI vLLM fork (`ghcr.io/swiss-ai/vllm_apertus_1.5_release`)     | native, `apertus`; not in thinking mode                                                       | 256K    | not planned | yes (BF16)                      | none on card                                     |

Notes on the table:

- Scores are self-reported by each model's authors, with different prompts, shot
  counts, graders and benchmark versions. They are not comparable across rows and are not
  TwinLLM results. TwinLLM's own numbers come from the synthetic question set
  ([evaluation/question-set.md](evaluation/question-set.md)).
- Context is the model's configured maximum (Ollama runs 4096 tokens by default). Qwen3
  is 32K native and 128K with YaRN; Ollama lists 256K for its current `qwen3:4b` tag.
- Meditron3 scores are the card's "MediCouenne-7B" checkpoint row. The card says the
  model is research-only and not validated for medical use.
- The MedGemma card scores 1.5 4B; the Ollama `medgemma:4b` tag does not say which
  MedGemma release it packages.
- Sizes on disk are for the named file. BF16 needs about 2 bytes per parameter (an 8B
  model is about 16 GB before the KV cache).

## Licence notes

**MedGemma (Health AI Developer Foundations terms, HAI-DEF).** Plain reading, not legal
advice:

- Access is gated: accept the HAI-DEF terms on Hugging Face first. The terms set no
  non-commercial limit, and research on synthetic data is not Clinical Use.
- "Clinical Use" is use with real patients in care, including inside a research study.
  The terms bar uses that could make Google a medical-device manufacturer and require
  regulatory authorisation where it applies. TwinLLM does not do Clinical Use.
- Hosting MedGemma behind an API or a public web demo counts as distribution. We must
  pass the section 3.2 use restrictions on to users, give them a copy of the terms, and
  mark modified files. The NOTICE line ("HAI-DEF is provided under and subject to the
  Health AI Developer Foundations Terms of Use") is required for other distribution; we
  add it to `NOTICE` before any public demo anyway. It is not there yet.
- We are solely responsible for outputs and for whether a use is appropriate. Outputs
  are not for clinical decisions (our reading of section 4.3 and of TwinLLM's scope; the
  terms do not say it in those words).

**Apertus v1.5.** Apache-2.0, but the repository is gated: downloading means accepting
the Swiss AI Acceptable Use Policy (`USAGE_POLICY.pdf` in the repository) and sharing
name and email with the authors. Read the policy before hosting it.

**II-Medical-8B.** Apache-2.0, and its card says it is not suitable for medical use. We
use it only as a comparison point on synthetic data.

## Where they run

**Laptop (Ollama, 8 GB, about 5 GB usable for the model):**

| Model                    | File                          | Note                                             |
| ------------------------ | ----------------------------- | ------------------------------------------------ |
| `qwen3:4b`               | Ollama tag, 2.5 GB            | Baseline; made a tool call on 2026-10-16.        |
| `medgemma:4b`            | Ollama tag, 3.3 GB            | No tools capability on Ollama.                   |
| Apertus-8B-MeditronFO Q4 | community GGUF Q4_K_M, 5.1 GB | Tight; Apertus support in Ollama not yet tested. |
| HuatuoGPT-o1-7B Q4       | community GGUF Q4_K_M, 4.7 GB | Tight.                                           |

**Exoscale A30 large:** 3× NVIDIA A30, 24 GB each, 72 GB VRAM in total. Exoscale lists
the A30 in CH-GVA-2 (Geneva); our zone is to be confirmed. TwinLLM reaches it as
`LLM_PROVIDER=exoscale`, one vLLM server per GPU: setup, URLs and the data policy are in
[providers.md](providers.md#exoscale-a30).

- One model per GPU. Tensor parallelism needs the attention-head count to divide by the
  GPU count, and 32 heads do not divide by 3. Three GPUs serve three models side by side.
- The A30 is Ampere. vLLM lists FP8 W8A8 as unsupported there; FP8 checkpoints run
  through the Marlin kernel, which quantises weights only. Plan memory on that basis.

Four candidates for three GPUs, so three run at a time:

| Model                    | vLLM tool parser | Note                                                     |
| ------------------------ | ---------------- | -------------------------------------------------------- |
| Qwen3-8B                 | `hermes`         | Baseline.                                                |
| Apertus-8B-Instruct-2509 | `apertus`        | Swiss AI base of the MeditronFO model.                   |
| Apertus-8B-MeditronFO    | `apertus`        | Tool template kept; untested after the fine-tune.        |
| MedGemma-27B-text, 4-bit | none             | No native tool calling; labelled as such in the results. |

## Sources

- Exoscale A30: https://www.exoscale.com/gpu/a30/
- MedGemma 27B: https://huggingface.co/google/medgemma-27b-it
- MedGemma 1.5 4B: https://huggingface.co/google/medgemma-1.5-4b-it
- Ollama MedGemma tags: https://ollama.com/library/medgemma/tags
- Ollama Qwen3 tags: https://ollama.com/library/qwen3/tags
- HAI-DEF terms: https://developers.google.com/health-ai-developer-foundations/terms
- Apertus-8B-MeditronFO: https://huggingface.co/EPFLiGHT/Apertus-8B-MeditronFO
- Apertus-70B-MeditronFO: https://huggingface.co/EPFLiGHT/Apertus-70B-MeditronFO
- Fully Open Meditron (MeditronFO paper): https://arxiv.org/abs/2605.16215
- Meditron3-Qwen2.5-7B: https://huggingface.co/EPFLiGHT/Meditron3-Qwen2.5-7B
- II-Medical-8B: https://huggingface.co/Intelligent-Internet/II-Medical-8B
- HuatuoGPT-o1-7B: https://huggingface.co/FreedomIntelligence/HuatuoGPT-o1-7B
- Baichuan-M2-32B: https://huggingface.co/baichuan-inc/Baichuan-M2-32B
- Apertus-8B-Instruct-2509: https://huggingface.co/swiss-ai/Apertus-8B-Instruct-2509
- Apertus-v1.5-8B: https://huggingface.co/swiss-ai/Apertus-v1.5-8B
- Qwen3-8B: https://huggingface.co/Qwen/Qwen3-8B
- Qwen function calling (vLLM `hermes`): https://qwen.readthedocs.io/en/latest/framework/function_call.html
- vLLM tool calling: https://docs.vllm.ai/en/latest/features/tool_calling.html
- vLLM quantization hardware table: https://docs.vllm.ai/en/latest/features/quantization/index.html
