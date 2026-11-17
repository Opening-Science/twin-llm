#!/usr/bin/env bash
# bun run voice:setup — install the speech sidecar's engines on this machine
# (docs/voice.md). Run it yourself: it downloads about 400 MB after you say yes.
#
#   whisper.cpp v1.9.5 (MIT), built from source for the CPU, and one
#   multilingual model (small, 5-bit, 190 MB; --model base for 60 MB)
#   Piper 1.8.0 (piper-tts, GPL-3.0) in its own Python environment, run as a
#   separate program, and two voices: en_GB-alba-medium (CC BY 4.0) and
#   de_DE-thorsten-medium (CC0)
#
# Everything is pinned: the whisper.cpp commit, the model and voice files by
# SHA-256 at a fixed Hugging Face revision, and the Piper version. A file that
# does not match is deleted and the script stops. Nothing runs on a GPU.
#
# Usage: scripts/voice/setup.sh [--home DIR] [--model small|base] [--yes]
# Needs: git, cmake, a C++ compiler, curl, sha256sum, uv.
set -euo pipefail

HOME_DIR="${VOICE_HOME:-$HOME/.local/share/twinllm-voice}"
MODEL="small"
ASSUME_YES="no"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --home) HOME_DIR="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --yes) ASSUME_YES="yes"; shift ;;
    *) echo "voice:setup: unknown option $1" >&2; exit 2 ;;
  esac
done

WHISPER_REPO="https://github.com/ggml-org/whisper.cpp.git"
WHISPER_TAG="v1.9.5"
WHISPER_COMMIT="d1be6fde11ac6e0407606b4e42fe72d34add8037"
WHISPER_MODELS="https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1"
case "$MODEL" in
  small)
    MODEL_FILE="ggml-small-q5_1.bin"
    MODEL_SHA256="ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb"
    MODEL_MB=190 ;;
  base)
    MODEL_FILE="ggml-base-q5_1.bin"
    MODEL_SHA256="422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898"
    MODEL_MB=60 ;;
  *) echo "voice:setup: --model is small or base" >&2; exit 2 ;;
esac

PIPER_VERSION="1.8.0"
VOICES="https://huggingface.co/rhasspy/piper-voices/resolve/0ca208afc2a2ee102b1e961e72e0a7e4907be3d0"
# path|sha256 of the .onnx|sha256 of the .onnx.json
VOICE_EN="en/en_GB/alba/medium/en_GB-alba-medium|1f9da809b6da1ef4190bb5dd6cce4f4af803274539e9cf9e0693085150bac3d7|ed4b1f015a8aae5eb26d4bdeed7b712c660f5698a0dd954aa6df9c8be60b900b"
VOICE_DE="de/de_DE/thorsten/medium/de_DE-thorsten-medium|fd270eb3d1ebf91d763f8a0f949b1b1bebdfefaea18c3aaf8577dd34536e064f|e5bb7410dcbbcc0be6f4544f6bc66612b315ab5cb3099ec44bb46d860bc7cca9"

for tool in git cmake curl sha256sum uv; do
  command -v "$tool" > /dev/null || { echo "voice:setup: $tool is missing" >&2; exit 1; }
done

cat <<PLAN
Voice setup into $HOME_DIR
  whisper.cpp $WHISPER_TAG, built here for the CPU
  speech-to-text model $MODEL_FILE (about $MODEL_MB MB)
  Piper $PIPER_VERSION in its own Python environment (about 80 MB with onnxruntime)
  voices en_GB-alba-medium and de_DE-thorsten-medium (about 63 MB each)
Sources: github.com, huggingface.co, pypi.org. Nothing is sent but the requests.
PLAN
if [[ "$ASSUME_YES" != "yes" ]]; then
  read -r -p "Download and build? [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]] || { echo "Nothing done."; exit 0; }
fi

mkdir -p "$HOME_DIR/models" "$HOME_DIR/voices"
chmod 700 "$HOME_DIR"

# fetch URL DEST SHA256: download to a .part file, check, then move into place.
fetch() {
  local url="$1" dest="$2" want="$3"
  if [[ -f "$dest" ]] && echo "$want  $dest" | sha256sum --check --status; then
    echo "have $(basename "$dest")"
    return
  fi
  curl --fail --location --proto '=https' --tlsv1.2 --output "$dest.part" "$url"
  if ! echo "$want  $dest.part" | sha256sum --check --status; then
    rm -f "$dest.part"
    echo "voice:setup: $(basename "$dest") does not match its pinned SHA-256; stopped" >&2
    exit 1
  fi
  mv "$dest.part" "$dest"
  echo "got $(basename "$dest")"
}

# whisper.cpp from the pinned tag, checked against its commit, CPU only.
SRC="$HOME_DIR/whisper.cpp"
if [[ ! -d "$SRC/.git" ]]; then
  git clone --depth 1 --branch "$WHISPER_TAG" "$WHISPER_REPO" "$SRC"
fi
GOT="$(git -C "$SRC" rev-parse HEAD)"
if [[ "$GOT" != "$WHISPER_COMMIT" ]]; then
  echo "voice:setup: whisper.cpp is at $GOT, expected $WHISPER_COMMIT; stopped" >&2
  exit 1
fi
cmake -S "$SRC" -B "$SRC/build" -DCMAKE_BUILD_TYPE=Release \
  -DGGML_CUDA=OFF -DGGML_VULKAN=OFF -DGGML_METAL=OFF -DWHISPER_BUILD_TESTS=OFF
cmake --build "$SRC/build" --config Release --target whisper-cli -j "$(nproc)"

fetch "$WHISPER_MODELS/$MODEL_FILE" "$HOME_DIR/models/$MODEL_FILE" "$MODEL_SHA256"

# Piper in its own environment; the app never imports it.
uv venv --quiet --python 3.12 "$HOME_DIR/piper"
uv pip install --quiet --python "$HOME_DIR/piper/bin/python" "piper-tts==$PIPER_VERSION"

voice() {
  local spec="$1" path onnx_sha json_sha name
  IFS='|' read -r path onnx_sha json_sha <<< "$spec"
  name="$(basename "$path")"
  fetch "$VOICES/$path.onnx" "$HOME_DIR/voices/$name.onnx" "$onnx_sha"
  fetch "$VOICES/$path.onnx.json" "$HOME_DIR/voices/$name.onnx.json" "$json_sha"
}
voice "$VOICE_EN"
voice "$VOICE_DE"

THREADS="$(( $(nproc) > 8 ? 8 : $(nproc) ))"
cat > "$HOME_DIR/voice.json" <<JSON
{
  "whisper": {
    "bin": "$SRC/build/bin/whisper-cli",
    "model": "$HOME_DIR/models/$MODEL_FILE",
    "threads": $THREADS
  },
  "piper": {
    "bin": "$HOME_DIR/piper/bin/piper",
    "voices": {
      "en": "$HOME_DIR/voices/en_GB-alba-medium.onnx",
      "de": "$HOME_DIR/voices/de_DE-thorsten-medium.onnx"
    }
  }
}
JSON

echo "Done. Start it with: bun run voice:serve"
echo "Then set VOICE_SIDECAR_URL=http://127.0.0.1:8095 in .env.local"
