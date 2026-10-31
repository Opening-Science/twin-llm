#!/bin/bash
# GPU steps of the disclosure experiment (#301), in order, each one waiting until
# no other process holds more than 1 GB on the card (polls every minute, gives up
# after two hours). Every step is resumable: rerun the script after a stop.
#
#   RUN=../twin-llm-disclosure-run scripts/disclosure/run-gpu.sh
#
# Needs the fine-tuning pilot's Python environment (PILOT, read-only) and gguf-py
# in $RUN/pylib for the dequantized exports (see docs/research/disclosure-2026-10.md).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="$(cd "${RUN:?set RUN to the run directory}" && pwd)"
PILOT="${PILOT:-/home/mia/Projects/finetune-pilot}"
PY="${PY:-$PILOT/.venv/bin/python}"
BASE=unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit
export HF_HOME="${HF_HOME:-/home/mia/Projects/finetune-feasibility/hf-cache}" HF_HUB_OFFLINE=1
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True PILOT_DIR="$PILOT" PYTHONPATH="$RUN/pylib"
cd "$RUN"
mkdir -p logs

wait_gpu() {
  for _ in $(seq 120); do
    busy=$(nvidia-smi --query-compute-apps=used_memory --format=csv,noheader,nounits | awk '$1 > 1000' | wc -l)
    [ "$busy" -eq 0 ] && return 0
    echo "$(date -Is) GPU busy, waiting" >&2
    sleep 60
  done
  echo "GPU still busy after two hours; stopping" >&2
  exit 1
}

step() { # name, then the command
  local name=$1; shift
  [ -f "logs/$name.done" ] && { echo "skip $name"; return 0; }
  wait_gpu
  echo "$(date -Is) start $name"
  "$@" > "logs/$name.log" 2>&1
  date -Is > "logs/$name.done"
}

score() { # model dir/id, adapter or "", items, out name
  local adapter=()
  [ -n "$2" ] && adapter=(--adapter "$2")
  step "score-$4-$3" "$PY" "$HERE/score.py" --items "sets/$3.jsonl" --out "scores/$4/$3.jsonl" --model "$1" --chunk "${CHUNK:-0}" "${adapter[@]}"
}

probe_hf() { # model, adapter or "", probes, out name, then extra flags (--prefill)
  local adapter=()
  [ -n "$2" ] && adapter=(--adapter "$2")
  local model=$1 probes=$3 name=$4
  shift 4
  step "probe-$name-$probes" "$PY" "$HERE/probe.py" --backend hf --probes "sets/$probes.jsonl" --out "probes/$name/$probes.jsonl" --model "$model" "${adapter[@]}" "$@"
}

score "$BASE" "" pilot-items base-4bit
score "$BASE" "$PILOT/runs/pilot1/lora" pilot-items pilot-adapter
score "$BASE" "" control-items base-4bit
step train-control "$PY" "$HERE/train_control.py" --data sets --out control --epochs "${EPOCHS:-10}"
score "$BASE" "$RUN/control/lora" control-items control-adapter
# the pilot as a same-distribution reference for the control (trained on the templates, not on its people)
score "$BASE" "$PILOT/runs/pilot1/lora" control-items pilot-adapter
CHUNK=512 score "$RUN/served/pilot1-q4km" "" pilot-items pilot-q4km
CHUNK=512 score "$RUN/served/base-q4km" "" pilot-items base-q4km
probe_hf "$BASE" "$PILOT/runs/pilot1/lora" pilot-probes pilot-adapter
probe_hf "$BASE" "" pilot-probes base-4bit
probe_hf "$BASE" "$RUN/control/lora" control-probes control-adapter
probe_hf "$BASE" "" control-probes base-4bit
probe_ollama() { # Ollama model, out name, then extra flags (--prefill)
  local model=$1 name=$2
  shift 2
  step "probe-$name-pilot-probes" "$PY" "$HERE/probe.py" --backend ollama --model "$model" --probes sets/pilot-probes.jsonl --out "probes/$name/pilot-probes.jsonl" "$@"
  ollama stop "$model" 2>/dev/null || true
}
probe_ollama twinllm-qwen3-4b-pilot1 pilot-ollama
probe_ollama twinllm-qwen3-4b-base base-ollama
# completion probes: the reference answer up to the value, no tool result in context
probe_hf "$BASE" "$PILOT/runs/pilot1/lora" pilot-probes pilot-adapter-prefill --prefill
probe_hf "$BASE" "" pilot-probes base-4bit-prefill --prefill
probe_hf "$BASE" "$RUN/control/lora" control-probes control-adapter-prefill --prefill
probe_hf "$BASE" "" control-probes base-4bit-prefill --prefill
probe_ollama twinllm-qwen3-4b-pilot1 pilot-ollama-prefill --prefill
probe_ollama twinllm-qwen3-4b-base base-ollama-prefill --prefill
echo "$(date -Is) all GPU steps done"
