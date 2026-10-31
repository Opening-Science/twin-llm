"""Step 3: per-token log-probabilities of the trained tokens, one model at a time.

    python scripts/disclosure/score.py --items <run>/sets/pilot-items.jsonl \
        --out <run>/scores/pilot-adapter/pilot-items.jsonl \
        --model unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit --adapter <pilot>/runs/pilot1/lora

Every conversation shares the system prompt and tools block, so its key/value
cache is computed once and cropped back after each conversation; the first
conversation is also scored without the cache as a check (fp16 kernels differ
between the two paths, so single tokens can move; the mean must agree). Writes one line per
conversation: id, token count, natural-log probabilities (6 significant digits, so
near-zero losses of a fine-tune keep their order), digit
flags and the zlib size of the trained text. Resumable.
"""
import argparse
import json
import os
import time
import zlib

import torch

from shared import USER, done_ids, load_model, load_tokenizer, ollama_tools, read_jsonl, render, target_spans

ap = argparse.ArgumentParser()
ap.add_argument("--items", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--model", required=True)
ap.add_argument("--adapter", default=None)
ap.add_argument("--limit", type=int, default=None)
ap.add_argument("--chunk", type=int, default=0,
                help="feed the model this many tokens at a time (0: all at once); fp16 models need 512 on 11 GB")
args = ap.parse_args()
os.makedirs(os.path.dirname(args.out), exist_ok=True)

tok = load_tokenizer()
model = load_model(args.model, args.adapter)
tools = ollama_tools()
items = read_jsonl(args.items)[: args.limit] if args.limit else read_jsonl(args.items)
done = done_ids(args.out)
todo = [item for item in items if item["id"] not in done]
print(f"{len(todo)} to score, {len(done)} already done", flush=True)


def split(text):
    cut = text.index(USER)
    prefix = tok(text[:cut], add_special_tokens=False).input_ids
    enc = tok(text[cut:], add_special_tokens=False, return_offsets_mapping=True)
    full = tok(text, add_special_tokens=False).input_ids
    assert full == prefix + enc.input_ids, "prefix split changed the tokens"
    spans = target_spans(text)
    targets = [j for j, (a, _) in enumerate(enc.offset_mapping)
               if j > 0 and any(s <= a + cut < e for s, e in spans)]
    return text[:cut], prefix, enc.input_ids, targets, spans


def token_lp(logits, ids, targets, rows_at=lambda j: j - 1):
    """log p(ids[j]) for each target j, from the logits row rows_at(j), 128 rows at a time."""
    out = []
    for start in range(0, len(targets), 128):
        part = targets[start: start + 128]
        lp = torch.log_softmax(logits[[rows_at(j) for j in part]].float(), dim=-1)
        out += lp[torch.arange(len(part)), torch.tensor([ids[j] for j in part], device=lp.device)].tolist()
    return out


def forward(ids, cache, keep):
    """Feed ids through the model on top of cache, --chunk tokens at a time; returns the
    cache and the logits of the last `keep` positions (0: none)."""
    step = args.chunk or len(ids)
    kept = []
    for start in range(0, len(ids), step):
        piece = ids[start: start + step]
        want = max(0, keep - (len(ids) - start - len(piece)))  # kept positions inside this piece
        res = model(input_ids=torch.tensor([piece], device="cuda"), past_key_values=cache, use_cache=True,
                    logits_to_keep=max(1, min(want, len(piece))))
        cache = res.past_key_values
        if want > 0:
            kept.append(res.logits[0][-min(want, len(piece)):])
    return cache, (torch.cat(kept) if kept else None)


cache = None
cache_text = None
cache_len = 0
t0 = time.time()
with torch.no_grad(), open(args.out, "a") as out:
    for n, item in enumerate(todo):
        text = render(tok, item["messages"], tools)
        prefix_text, prefix, suffix, targets, spans = split(text)
        if prefix_text != cache_text:
            cache, _ = forward(prefix, None, 0)
            cache_text, cache_len = prefix_text, len(prefix)
        cache, logits = forward(suffix, cache, len(suffix))
        lp = token_lp(logits, suffix, targets)
        del logits
        cache.crop(-len(suffix))  # back to the shared prefix
        assert cache.get_seq_length() == cache_len
        if n == 0:
            # the whole conversation on a fresh cache (the shared one is dropped first to fit fp16
            # weights on 11 GB and rebuilt for the next conversation); row j of the kept logits
            # predicts suffix token j
            cache, cache_text = None, None
            torch.cuda.empty_cache()
            fresh, full = forward(prefix + suffix, None, len(suffix) + 1)
            ref = token_lp(full, suffix, targets, rows_at=lambda j: j)
            diffs = [abs(a - b) for a, b in zip(lp, ref)]
            mean_diff = sum(diffs) / len(diffs)
            shift = abs(sum(lp) - sum(ref)) / len(lp)
            print(f"cache check over {len(lp)} tokens: mean |difference| {mean_diff:.2e}, max {max(diffs):.2e}, "
                  f"difference of means {shift:.2e} (fp16 noise)", flush=True)
            assert mean_diff < 0.05 and shift < 0.01, "cached scoring disagrees with full scoring"
            del fresh, full
            torch.cuda.empty_cache()
        pieces = [tok.decode([suffix[j]]) for j in targets]
        trained = "".join(text[s:e] for s, e in spans)
        row = {"id": item["id"], "n": len(lp), "lp": [float(f"{x:.6g}") for x in lp],
               "digit": [1 if any(ch.isdigit() for ch in p) else 0 for p in pieces],
               "zlib": len(zlib.compress(trained.encode(), 9))}
        out.write(json.dumps(row) + "\n")
        out.flush()
        if (n + 1) % 50 == 0:
            el = time.time() - t0
            print(f"{n + 1}/{len(todo)} {el / (n + 1):.2f} s each", flush=True)
print(f"done in {time.time() - t0:.0f} s; peak {torch.cuda.max_memory_allocated() / 2**30:.1f} GiB", flush=True)
