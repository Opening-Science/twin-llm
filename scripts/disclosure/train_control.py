"""Step 2a: the positive control, a deliberately overfit QLoRA fine-tune on very few
synthetic people. Same settings as the pilot's train.py (Qwen3-4B 4-bit, r=16,
alpha=16, all linear layers, lr 2e-4 cosine, 3 % warmup, adamw_8bit, batch 4 x 4,
loss on assistant turns only, same template and tools), but many epochs on the
control's training file instead of one epoch on 10,000 conversations.

    cd <run> && python scripts/disclosure/train_control.py --data sets --out control --epochs 10

Run it from the run directory: Unsloth writes its compiled cache to the working
directory.
"""
import argparse
import json
import os
import time

import unsloth  # noqa: F401  (must be imported before transformers/trl)
from unsloth import FastLanguageModel
from unsloth.chat_templates import train_on_responses_only

import torch
from datasets import Dataset
from trl import SFTConfig, SFTTrainer

from shared import BASE_4BIT, ollama_tools, read_jsonl, render

ap = argparse.ArgumentParser()
ap.add_argument("--data", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--epochs", type=int, default=10)
ap.add_argument("--max-seq-len", type=int, default=3584)
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)

model, tok = FastLanguageModel.from_pretrained(
    model_name=BASE_4BIT, max_seq_length=args.max_seq_len, dtype=torch.float16, load_in_4bit=True)
model = FastLanguageModel.get_peft_model(
    model, r=16, lora_alpha=16, lora_dropout=0, bias="none",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth", random_state=3407)
tools = ollama_tools()
train = [render(tok, r["messages"], tools) for r in read_jsonl(os.path.join(args.data, "control-train.jsonl"))]
val = [render(tok, r["messages"], tools) for r in read_jsonl(os.path.join(args.data, "control-val.jsonl"))]
assert not any("<think>" in t for t in train + val)

trainer = SFTTrainer(
    model=model,
    processing_class=tok,
    train_dataset=Dataset.from_dict({"text": train}),
    eval_dataset=Dataset.from_dict({"text": val}),
    args=SFTConfig(
        dataset_text_field="text", max_length=args.max_seq_len, packing=False,
        per_device_train_batch_size=4, gradient_accumulation_steps=4, per_device_eval_batch_size=4,
        num_train_epochs=args.epochs, warmup_steps=0.03, learning_rate=2e-4, lr_scheduler_type="cosine",
        optim="adamw_8bit", weight_decay=0.01, max_grad_norm=1.0, fp16=True, bf16=False,
        logging_steps=2, eval_strategy="epoch", save_strategy="no", report_to="none",
        seed=3407, data_seed=3407, output_dir=args.out, dataloader_num_workers=0,
    ),
)
trainer = train_on_responses_only(trainer, instruction_part="<|im_start|>user\n", response_part="<|im_start|>assistant\n")
t = time.time()
res = trainer.train()
hist = trainer.state.log_history
metrics = {
    "base": BASE_4BIT, "epochs": args.epochs, "n_train": len(train), "n_val": len(val),
    "steps": trainer.state.global_step, "wall_s": time.time() - t, "train_loss_mean": res.training_loss,
    "train_loss_curve": [(h["step"], h["loss"]) for h in hist if "loss" in h],
    "eval_loss_curve": [(h["step"], h["eval_loss"]) for h in hist if "eval_loss" in h],
    "peak_torch_allocated_gib": torch.cuda.max_memory_allocated() / 2**30,
}
json.dump(metrics, open(os.path.join(args.out, "metrics.json"), "w"), indent=2)
model.save_pretrained(os.path.join(args.out, "lora"))
tok.save_pretrained(os.path.join(args.out, "lora"))
print("METRICS", json.dumps({k: v for k, v in metrics.items() if not k.endswith("curve")}), flush=True)
