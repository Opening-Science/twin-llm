"""Step 4: exact-value extraction probe. Ask each probe's question with the training
system prompt and no tools, greedy, and keep the answer. Matching happens in
analyze.ts.

    python scripts/disclosure/probe.py --probes <run>/sets/pilot-probes.jsonl \
        --out <run>/probes/pilot-adapter/pilot-probes.jsonl --backend hf --model <id> [--adapter <dir>]
    python scripts/disclosure/probe.py ... --backend ollama --model twinllm-qwen3-4b-pilot1

With --prefill the model gets no question to answer in its own words: the prompt ends
with the reference answer up to the value (the tool call and its result are left out),
and the next few tokens are kept. Through Ollama this uses /api/generate in raw mode
with the same rendered prompt. Resumable.
"""
import argparse
import json
import os
import time
import urllib.request

from shared import done_ids, read_jsonl

ap = argparse.ArgumentParser()
ap.add_argument("--probes", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--backend", choices=["hf", "ollama"], required=True)
ap.add_argument("--model", required=True)
ap.add_argument("--adapter", default=None)
ap.add_argument("--host", default="http://127.0.0.1:11434")
ap.add_argument("--max-new-tokens", type=int, default=200)
ap.add_argument("--batch", type=int, default=16)
ap.add_argument("--prefill", action="store_true", help="completion probe (12 new tokens)")
args = ap.parse_args()
os.makedirs(os.path.dirname(args.out), exist_ok=True)

probes = read_jsonl(args.probes)
if args.prefill:
    probes = [p for p in probes if p.get("prefill")]
    args.max_new_tokens = 12
done = done_ids(args.out)
todo = [p for p in probes if p["id"] not in done]
print(f"{len(todo)} to ask, {len(done)} already done", flush=True)


def messages(p):
    return [{"role": "system", "content": p["system"]}, {"role": "user", "content": p["question"]}]


def write(out, p, answer):
    out.write(json.dumps({"id": p["id"], "member": p["member"], "answer": answer}) + "\n")
    out.flush()


t0 = time.time()
with open(args.out, "a") as out:
    if args.backend == "ollama":
        if args.prefill:
            from shared import load_tokenizer, render

            tok = load_tokenizer()
        for p in todo:
            options = {"temperature": 0, "seed": 0, "num_predict": args.max_new_tokens}
            if args.prefill:
                prompt = render(tok, messages(p), None, add_generation_prompt=True) + p["prefill"]
                path, body = "generate", {"model": args.model, "prompt": prompt, "raw": True, "stream": False,
                                          "keep_alive": "10m", "options": options}
            else:
                path, body = "chat", {"model": args.model, "messages": messages(p), "stream": False,
                                      "keep_alive": "10m", "options": options}
            req = urllib.request.Request(f"{args.host}/api/{path}", json.dumps(body).encode(),
                                         {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=600) as r:
                res = json.loads(r.read())
            write(out, p, res["response"] if args.prefill else res["message"]["content"])
    else:
        import torch

        from shared import load_model, load_tokenizer, render

        tok = load_tokenizer()
        tok.padding_side = "left"
        model = load_model(args.model, args.adapter)
        for i in range(0, len(todo), args.batch):
            batch = todo[i: i + args.batch]
            prompts = [render(tok, messages(p), None, add_generation_prompt=True) + (p["prefill"] if args.prefill else "")
                       for p in batch]
            enc = tok(prompts, return_tensors="pt", padding=True, add_special_tokens=False).to("cuda")
            with torch.no_grad():
                gen = model.generate(**enc, max_new_tokens=args.max_new_tokens, do_sample=False,
                                     pad_token_id=tok.pad_token_id)
            for p, row in zip(batch, gen):
                write(out, p, tok.decode(row[enc.input_ids.shape[1]:], skip_special_tokens=True))
print(f"done in {time.time() - t0:.0f} s", flush=True)
