"""Step 2b: turn a served Ollama export (q4_K_M GGUF) back into an fp16 Hugging Face
checkpoint, so the served weights can be scored with the same code as the checkpoint.

    PYTHONPATH=<run>/pylib python scripts/disclosure/dequant_gguf.py \
        --gguf /var/lib/ollama/blobs/sha256-... --like <pilot>/export/qwen3-4b-pilot1-merged \
        --out <run>/served/pilot1-q4km

Every tensor is dequantized with gguf-py (the numbers llama.cpp computes with,
held in fp16 here), renamed to the Qwen3 layout (Qwen3 GGUFs are not permuted)
and written in shards. Config and tokenizer come from the merged export the GGUF
was made from. Prints the relative error against that export for one tensor.
"""
import argparse
import json
import os
import re
import shutil

import numpy as np
import torch
from gguf import GGUFReader
from gguf.quants import dequantize
from safetensors import safe_open
from safetensors.torch import save_file

ap = argparse.ArgumentParser()
ap.add_argument("--gguf", required=True)
ap.add_argument("--like", required=True)
ap.add_argument("--out", required=True)
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)

LAYER = {
    "attn_q": "self_attn.q_proj", "attn_k": "self_attn.k_proj", "attn_v": "self_attn.v_proj",
    "attn_output": "self_attn.o_proj", "attn_q_norm": "self_attn.q_norm", "attn_k_norm": "self_attn.k_norm",
    "attn_norm": "input_layernorm", "ffn_norm": "post_attention_layernorm",
    "ffn_gate": "mlp.gate_proj", "ffn_up": "mlp.up_proj", "ffn_down": "mlp.down_proj",
}
TOP = {"token_embd.weight": "model.embed_tokens.weight", "output_norm.weight": "model.norm.weight",
       "output.weight": "lm_head.weight"}


def hf_name(name):
    if name in TOP:
        return TOP[name]
    m = re.fullmatch(r"blk\.(\d+)\.(\w+)\.weight", name)
    if not m or m.group(2) not in LAYER:
        raise ValueError(f"unknown tensor {name}")
    return f"model.layers.{m.group(1)}.{LAYER[m.group(2)]}.weight"


reader = GGUFReader(args.gguf)
shard, shard_bytes, shards, index = {}, 0, [], {}


def flush():
    global shard, shard_bytes
    if not shard:
        return
    name = f"model-{len(shards) + 1:05d}.safetensors"
    save_file(shard, os.path.join(args.out, name), metadata={"format": "pt"})
    for key in shard:
        index[key] = name
    shards.append(name)
    shard, shard_bytes = {}, 0


for t in reader.tensors:
    arr = dequantize(t.data, t.tensor_type)
    shape = tuple(int(x) for x in reversed(t.shape.tolist()))
    tensor = torch.from_numpy(np.ascontiguousarray(arr.reshape(shape))).to(torch.float16)
    shard[hf_name(t.name)] = tensor
    shard_bytes += tensor.numel() * 2
    if shard_bytes > 1_500_000_000:
        flush()
flush()
# rename to the -of- form transformers expects
final = {}
for i, name in enumerate(shards):
    new = f"model-{i + 1:05d}-of-{len(shards):05d}.safetensors"
    os.replace(os.path.join(args.out, name), os.path.join(args.out, new))
    final[name] = new
json.dump({"metadata": {}, "weight_map": {k: final[v] for k, v in sorted(index.items())}},
          open(os.path.join(args.out, "model.safetensors.index.json"), "w"), indent=1)

config = json.load(open(os.path.join(args.like, "config.json")))
config["torch_dtype"] = "float16"
config["dtype"] = "float16"
json.dump(config, open(os.path.join(args.out, "config.json"), "w"), indent=2)
for f in ("tokenizer.json", "tokenizer_config.json", "generation_config.json", "chat_template.jinja"):
    if os.path.exists(os.path.join(args.like, f)):
        shutil.copy(os.path.join(args.like, f), os.path.join(args.out, f))

# one tensor against the merged export the GGUF came from
key = "model.layers.0.mlp.gate_proj.weight"
like_index = json.load(open(os.path.join(args.like, "model.safetensors.index.json")))["weight_map"]
with safe_open(os.path.join(args.like, like_index[key]), "pt") as f:
    a = f.get_tensor(key).float()
with safe_open(os.path.join(args.out, final[index[key]]), "pt") as f:
    b = f.get_tensor(key).float()
print(f"{len(reader.tensors)} tensors, {len(shards)} shards; {key}: relative error "
      f"{((a - b).norm() / a.norm()).item():.4f} against {args.like}")
