"""Shared helpers for the GPU half of the disclosure experiment (#301).

Rendering comes from the fine-tuning pilot's own `common.py` (read-only), so
the text scored here is byte for byte the text the pilot trained on: the
Qwen3 template without empty think blocks and the tools as Ollama sends them.
"""
import json
import os
import sys

PILOT_DIR = os.environ.get("PILOT_DIR", "/home/mia/Projects/finetune-pilot")
BASE_4BIT = "unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit"
ASSISTANT = "<|im_start|>assistant\n"
USER = "<|im_start|>user\n"

sys.path.insert(0, PILOT_DIR)
from common import ollama_tools, render  # noqa: E402  (the pilot's renderer)


def read_jsonl(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def done_ids(path):
    if not os.path.exists(path):
        return set()
    return {row["id"] for row in read_jsonl(path)}


def target_spans(text):
    """Character spans the pilot trained on: from after each assistant header to
    the next user header (tool results render as user turns), as Unsloth's
    train_on_responses_only masks them."""
    spans = []
    start = text.find(ASSISTANT)
    while start != -1:
        begin = start + len(ASSISTANT)
        end = text.find(USER, begin)
        end = len(text) if end == -1 else end
        spans.append((begin, end))
        start = text.find(ASSISTANT, end)
    return spans


def load_model(model, adapter=None):
    """A 4-bit bitsandbytes checkpoint by hub id, or a local fp16 directory."""
    import torch
    from transformers import AutoModelForCausalLM

    m = AutoModelForCausalLM.from_pretrained(model, dtype=torch.float16, device_map={"": 0})
    if adapter:
        from peft import PeftModel

        m = PeftModel.from_pretrained(m, adapter)
    m.eval()
    return m


def load_tokenizer():
    from transformers import AutoTokenizer

    return AutoTokenizer.from_pretrained(BASE_4BIT)


__all__ = ["ollama_tools", "render", "read_jsonl", "done_ids", "target_spans", "load_model",
           "load_tokenizer", "BASE_4BIT", "USER"]
