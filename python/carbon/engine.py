"""Load Carbon-X from a pinned local snapshot in 4-bit NF4 and answer requests.

Why the loader is hand-rolled: on an 11 GB Turing card that also drives a desktop, the
4-bit decoder (about 7 GB) does not fit next to the KV cache. Transformers' own CPU
offload keeps offloaded layers unquantised (fp16/fp32, 0.7-1.3 GB each in host RAM). Here
every decoder layer is quantised to NF4 on the GPU; the layers that do not fit keep their
packed 4-bit weights in pinned host RAM (about 170 MB each) and are copied to the GPU for
each forward pass. The token embedding stays on the CPU (a lookup). Everything else,
including the NF4 lm_head and the quantisation statistics, stays on the GPU.

No network: HF_HUB_OFFLINE=1 and local_files_only are set before transformers is
imported. Safetensors only. bf16 weights become fp16 (Turing has no bf16 compute).
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import torch
from torch import nn

from protocol import ChatRequest, Generation, LogLikelihood

log = logging.getLogger("carbon")

NF4_LAYER_BYTES = 164 * 1024**2  # measured: one decoder layer in NF4 with double quant, incl. statistics
KV_BYTES_PER_TOKEN = 40 * 2 * 8 * 128 * 2  # layers x (k, v) x kv heads x head dim x fp16
GPU_RESERVE_BYTES = 1_400 * 1024**2  # activations, a streamed layer, allocator slack


def snapshot_revision(model_dir: Path) -> str | None:
    """The commit sha huggingface_hub recorded when it downloaded the snapshot."""
    meta = model_dir / ".cache" / "huggingface" / "download" / "config.json.metadata"
    if not meta.exists():
        return None
    return meta.read_text(encoding="utf-8").splitlines()[0].strip()


def load_engine(
    model_dir: str,
    revision: str,
    hf_home: str | None,
    max_context: int,
    gpu_layers: int | None,
    threads: int,
) -> "CarbonEngine":
    root = Path(model_dir).expanduser().resolve()
    if not (root / "config.json").exists():
        raise SystemExit(f"No Carbon-X snapshot at {root}.")
    recorded = snapshot_revision(root)
    if recorded is not None and recorded != revision:
        raise SystemExit(f"Snapshot is revision {recorded}, expected {revision}.")
    if any(root.glob("*.bin")) or any(root.glob("*.pt")) or any(root.glob("*.pkl")):
        raise SystemExit("Snapshot contains pickle weights; this sidecar loads safetensors only.")

    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    if hf_home:
        os.environ["HF_HOME"] = str(Path(hf_home).expanduser().resolve())

    torch.set_num_threads(threads)
    if not torch.cuda.is_available():
        raise SystemExit("No CUDA device. Carbon-X in 4-bit needs a GPU.")
    return CarbonEngine(root, revision, max_context, gpu_layers)


class CpuEmbedding(nn.Module):
    """Token lookup on the CPU, result moved to the GPU. Holds the table as a plain
    tensor (not a parameter) so `model.device` still reports the GPU."""

    def __init__(self, table: torch.Tensor, device: torch.device):
        super().__init__()
        self.table = table
        self.target = device
        self.num_embeddings, self.embedding_dim = table.shape

    def forward(self, ids: torch.Tensor) -> torch.Tensor:
        return nn.functional.embedding(ids.to("cpu"), self.table).to(self.target)


class CarbonEngine:
    def __init__(self, root: Path, revision: str, max_context: int, gpu_layers: int | None):
        from transformers import AutoConfig, AutoTokenizer, GenerationConfig

        self.revision = revision
        self.max_context = max_context
        self.device = torch.device("cuda:0")
        started = time.monotonic()

        self.tokenizer = AutoTokenizer.from_pretrained(
            str(root), trust_remote_code=True, local_files_only=True
        )
        config = AutoConfig.from_pretrained(str(root), local_files_only=True)
        config.use_cache = True
        self.generation_config = GenerationConfig.from_pretrained(str(root), local_files_only=True)
        eos = self.generation_config.eos_token_id or config.eos_token_id
        self.eos_ids = list(dict.fromkeys(eos if isinstance(eos, list) else [eos]))

        layers = config.num_hidden_layers
        free, total = torch.cuda.mem_get_info(self.device)
        if gpu_layers is None:
            lm_head = config.vocab_size * config.hidden_size // 2
            budget = free - lm_head - KV_BYTES_PER_TOKEN * max_context - GPU_RESERVE_BYTES
            gpu_layers = max(0, min(layers, budget // NF4_LAYER_BYTES))
        self.gpu_layers = int(min(gpu_layers, layers))
        self.streamed_layers = layers - self.gpu_layers
        log.info("free VRAM %.2f GB of %.2f GB; %d layers resident, %d streamed from host RAM",
                 free / 1e9, total / 1e9, self.gpu_layers, self.streamed_layers)

        self.model = _build_nf4_model(root, config, self.device, self.gpu_layers)
        self.load_seconds = time.monotonic() - started
        log.info("loaded in %.0f s; VRAM allocated %.2f GB", self.load_seconds,
                 torch.cuda.memory_allocated(self.device) / 1e9)

    # -- requests -------------------------------------------------------------------

    def _prompt_ids(self, request: ChatRequest) -> Any:
        messages = [{"role": m.role, "content": m.content} for m in request.messages]
        text = self.tokenizer.apply_chat_template(
            messages, add_generation_prompt=True, tokenize=False,
            enable_thinking=request.enable_thinking,
        )
        return self.tokenizer(text, return_tensors="pt")["input_ids"]

    def count_prompt_tokens(self, request: ChatRequest) -> int:
        return int(self._prompt_ids(request).shape[1])

    def generate(self, request: ChatRequest) -> Generation:
        ids = self._prompt_ids(request).to(self.device)
        greedy = request.temperature == 0.0
        if request.seed is not None:
            torch.manual_seed(request.seed)
        sampling: dict[str, Any] = (
            {"do_sample": False, "temperature": None, "top_p": None, "top_k": None}
            if greedy
            else {"do_sample": True, "temperature": request.temperature,
                  "top_p": request.top_p, "top_k": request.top_k}
        )
        torch.cuda.reset_peak_memory_stats(self.device)
        started = time.monotonic()
        with torch.inference_mode():
            out = self.model.generate(
                input_ids=ids,
                attention_mask=torch.ones_like(ids),
                max_new_tokens=request.max_tokens,
                eos_token_id=self.eos_ids,
                pad_token_id=self.generation_config.pad_token_id,
                use_cache=True,
                **sampling,
            )
        torch.cuda.synchronize(self.device)
        latency_ms = int((time.monotonic() - started) * 1000)
        new = out[0, ids.shape[1]:].tolist()
        stopped = bool(new) and new[-1] in self.eos_ids
        text = self.tokenizer.decode(new, skip_special_tokens=True).strip()
        return Generation(
            text=text,
            prompt_tokens=int(ids.shape[1]),
            completion_tokens=len(new),
            finish_reason="stop" if stopped or len(new) < request.max_tokens else "length",
            latency_ms=latency_ms,
            peak_vram_bytes=int(torch.cuda.max_memory_allocated(self.device)),
        )

    def log_likelihood(self, dna: str) -> LogLikelihood:
        """Sum of log p(DNA token | prefix) over the tokens of `<dna>{dna}</dna>`, as the
        model card's `compare` does."""
        ids = self.tokenizer(f"<dna>{dna}</dna>", return_tensors="pt", auto_dna_tags=False)["input_ids"]
        n = (len(dna) + 5) // 6
        if ids.shape[1] != n + 2:
            raise RuntimeError("DNA was not tokenised as <dna>, n 6-mers, </dna>.")
        ids = ids.to(self.device)
        torch.cuda.reset_peak_memory_stats(self.device)
        started = time.monotonic()
        with torch.inference_mode():
            hidden = self.model.model(input_ids=ids, use_cache=False).last_hidden_state[0]
            total = 0.0
            # One position at a time: for a single row bitsandbytes runs its 4-bit GEMV
            # kernel; for several rows it would dequantise the whole 1.6 GB lm_head first.
            for position in range(n):  # position i predicts token i+1 (the DNA tokens 1..n)
                logits = self.model.lm_head(hidden[position:position + 1]).float()
                total += float(torch.log_softmax(logits, dim=-1)[0, ids[0, position + 1]])
        latency_ms = int((time.monotonic() - started) * 1000)
        return LogLikelihood(
            log_likelihood=total,
            dna_tokens=n,
            prompt_tokens=int(ids.shape[1]),
            latency_ms=latency_ms,
            peak_vram_bytes=int(torch.cuda.max_memory_allocated(self.device)),
        )

    def health(self) -> dict[str, Any]:
        free, total = torch.cuda.mem_get_info(self.device)
        return {
            "model": "carbon-x",
            "revision": self.revision,
            "quantization": "bitsandbytes nf4, fp16 compute",
            "max_context": self.max_context,
            "layers_on_gpu": self.gpu_layers,
            "layers_streamed_from_host": self.streamed_layers,
            "vram": {
                "allocated_bytes": int(torch.cuda.memory_allocated(self.device)),
                "reserved_bytes": int(torch.cuda.memory_reserved(self.device)),
                "device_free_bytes": int(free),
                "device_total_bytes": int(total),
            },
            "device": torch.cuda.get_device_name(self.device),
        }


def _build_nf4_model(root: Path, config: Any, device: Any, gpu_layers: int) -> Any:
    import bitsandbytes as bnb
    from safetensors import safe_open
    from transformers import AutoModelForCausalLM

    with torch.device("meta"):
        model = AutoModelForCausalLM.from_config(config, dtype=torch.float16)

    # Swap every Linear in the decoder and the lm_head for an NF4 Linear4bit.
    for name, module in list(model.named_modules()):
        for child_name, child in list(module.named_children()):
            full = f"{name}.{child_name}" if name else child_name
            if isinstance(child, nn.Linear) and (full.startswith("model.layers.") or full == "lm_head"):
                setattr(module, child_name, bnb.nn.Linear4bit(
                    child.in_features, child.out_features, bias=child.bias is not None,
                    compute_dtype=torch.float16, compress_statistics=True, quant_type="nf4",
                    device="meta",
                ))

    index = json.loads((root / "model.safetensors.index.json").read_text(encoding="utf-8"))
    weight_map: dict[str, str] = index["weight_map"]
    by_file: dict[str, list[str]] = {}
    for key, file in weight_map.items():
        by_file.setdefault(file, []).append(key)

    def layer_of(key: str) -> int | None:
        parts = key.split(".")
        return int(parts[2]) if key.startswith("model.layers.") else None

    # A layer that will be streamed leaves the GPU as soon as all its tensors are in,
    # so the load never needs more VRAM than the resident layers.
    pending: dict[int, int] = {}
    for key in weight_map:
        layer = layer_of(key)
        if layer is not None:
            pending[layer] = pending.get(layer, 0) + 1

    for file, keys in sorted(by_file.items()):
        with safe_open(str(root / file), framework="pt", device="cpu") as handle:
            for key in sorted(keys, key=lambda k: (layer_of(k) is None, layer_of(k) or 0, k)):
                tensor = handle.get_tensor(key).to(torch.float16)
                module_path, param = key.rsplit(".", 1)
                module = model.get_submodule(module_path)
                if key == "model.embed_tokens.weight":
                    model.model.embed_tokens = CpuEmbedding(tensor, device)
                elif isinstance(module, bnb.nn.Linear4bit) and param == "weight":
                    quantised = bnb.nn.Params4bit(
                        tensor, requires_grad=False, quant_type="nf4", compress_statistics=True,
                        blocksize=64, module=module,
                    ).to(device)
                    module.weight = quantised
                else:
                    module._parameters[param] = nn.Parameter(tensor.to(device), requires_grad=False)
                del tensor
                layer = layer_of(key)
                if layer is not None:
                    pending[layer] -= 1
                    if pending[layer] == 0 and layer >= gpu_layers:
                        _stream_from_host(model.model.layers[layer], device)
                        torch.cuda.empty_cache()

    rotary = type(model.model.rotary_emb)
    model.model.rotary_emb = rotary(config=config).to(device)

    leftovers = [n for n, p in model.named_parameters() if p.device.type == "meta"]
    leftovers += [n for n, b in model.named_buffers() if b.device.type == "meta"]
    if leftovers:
        raise RuntimeError(f"Weights missing after load: {leftovers[:5]}")
    model.eval()
    torch.cuda.empty_cache()
    return model


def _stream_from_host(layer: Any, device: Any) -> None:
    """Keep this layer's packed NF4 weights in pinned host RAM; copy them in for each
    forward pass and drop the GPU copy afterwards. Quant statistics stay on the GPU."""
    import bitsandbytes as bnb

    linears = [m for m in layer.modules() if isinstance(m, bnb.nn.Linear4bit)]
    host = [m.weight.data.to("cpu").pin_memory() for m in linears]
    empty = torch.empty(0, dtype=torch.uint8, device=device)
    for module in linears:
        module.weight.data = empty

    def bring_in(_module: Any, _args: Any) -> None:
        for module, packed in zip(linears, host):
            module.weight.data = packed.to(device, non_blocking=True)

    def send_back(_module: Any, _args: Any, _output: Any) -> None:
        for module in linears:
            module.weight.data = empty

    layer.register_forward_pre_hook(bring_in)
    layer.register_forward_hook(send_back)
