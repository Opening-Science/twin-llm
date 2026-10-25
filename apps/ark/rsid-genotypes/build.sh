#!/bin/sh
# Build rsid-genotypes.wasm (WASI preview 1) and shrink it with wasm-opt.
set -eu
cd "$(dirname "$0")"
root=$(cd ../../.. && pwd)
out="${BUILD_DIR:-build}/rsid-genotypes.wasm"
wasm_opt="${WASM_OPT:-wasm-opt}"

command -v cargo >/dev/null 2>&1 || {
  echo "missing cargo" >&2
  exit 1
}
command -v "$wasm_opt" >/dev/null 2>&1 || {
  echo "missing wasm-opt; install Binaryen or set WASM_OPT" >&2
  exit 1
}

mkdir -p "$(dirname "$out")"
CARGO_ENCODED_RUSTFLAGS="$(printf '%s\037%s\037%s' \
  "--remap-path-prefix=$root=." \
  "--remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=cargo" \
  "--remap-path-prefix=$(rustc --print sysroot)=rust")"
export CARGO_ENCODED_RUSTFLAGS
cargo build --locked --release --target wasm32-wasip1
wasm="target/wasm32-wasip1/release/rsid-genotypes.wasm"
[ -f "$wasm" ] || {
  echo "no wasm output at $wasm" >&2
  exit 1
}
cp "$wasm" "$out"
"$wasm_opt" --mvp-features --enable-mutable-globals --enable-sign-ext \
  --enable-nontrapping-float-to-int --enable-bulk-memory --enable-bulk-memory-opt \
  --enable-simd --enable-relaxed-simd --enable-multivalue --enable-reference-types \
  --enable-tail-call --enable-extended-const \
  -O3 "$out" -o "$out.tmp"
mv "$out.tmp" "$out"
echo "built $out"
