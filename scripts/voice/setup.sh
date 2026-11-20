#!/usr/bin/env bash
# bun run voice:setup — install the speech sidecar's listening engine on this
# machine (docs/voice.md). Run it yourself: it downloads about 200 MB after you
# say yes.
#
#   whisper.cpp v1.9.5 (MIT), built from source for the CPU, and one
#   multilingual model (small, 5-bit, 190 MB; --model base for 60 MB)
#
# Nothing for speaking is fetched: answers are read aloud with the browser's
# own voices. Piper and Kokoro carry GPL-3.0 code and are never downloaded
# here; a person may install one themselves (docs/voice.md).
#
# Both are pinned: the whisper.cpp commit, and the model by SHA-256 at a fixed
# Hugging Face revision. A file that does not match is deleted and the script
# stops. Nothing runs on a GPU.
#
# Usage: scripts/voice/setup.sh [--home DIR] [--model small|base] [--yes]
# Needs: git, cmake, a C++ compiler, curl, sha256sum.
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

for tool in git cmake curl sha256sum; do
  command -v "$tool" > /dev/null || { echo "voice:setup: $tool is missing" >&2; exit 1; }
done

cat <<PLAN
Voice setup into $HOME_DIR
  whisper.cpp $WHISPER_TAG, built here for the CPU
  speech-to-text model $MODEL_FILE (about $MODEL_MB MB)
Nothing for speaking: answers are read aloud with the browser's own voices.
Sources: github.com, huggingface.co. Nothing is sent but the requests.
PLAN
if [[ "$ASSUME_YES" != "yes" ]]; then
  read -r -p "Download and build? [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]] || { echo "Nothing done."; exit 0; }
fi

mkdir -p "$HOME_DIR/models"
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

THREADS="$(( $(nproc) > 8 ? 8 : $(nproc) ))"
cat > "$HOME_DIR/voice.json" <<JSON
{
  "whisper": {
    "bin": "$SRC/build/bin/whisper-cli",
    "model": "$HOME_DIR/models/$MODEL_FILE",
    "threads": $THREADS
  }
}
JSON

echo "Done. Start it with: bun run voice:serve"
echo "Then set VOICE_SIDECAR_URL=http://127.0.0.1:8095 in .env.local"
