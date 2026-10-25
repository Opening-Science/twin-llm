#!/usr/bin/env bash
# Sync Opening-Science/open-twin at a pinned SHA into .open-twin/ (gitignored),
# rewrite workspace:* deps for standalone file: installs, and build package dist/
# trees. Does not edit upstream *.ts sources. Network: github.com only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OPEN_TWIN_SHA="${1:-${OPEN_TWIN_SHA:-a9e126c952c91e19e064a962dda7d815a43564e5}}"
OPEN_TWIN_REPO="${OPEN_TWIN_REPO:-https://github.com/Opening-Science/open-twin.git}"
DEST="${ROOT}/.open-twin"
PACKAGES=(fhir-core fhir-r4 provider-oura provider-google-health provider-whoop provider-vitronic interpretation-contract anchor-layer)

echo "sync-open-twin: pinning ${OPEN_TWIN_SHA}"

rm -rf "${DEST}"
git clone --filter=blob:none --sparse "${OPEN_TWIN_REPO}" "${DEST}"
cd "${DEST}"
git sparse-checkout set \
  packages/fhir-core \
  packages/fhir-r4 \
  packages/provider-oura \
  packages/provider-google-health \
  packages/provider-whoop \
  packages/provider-vitronic \
  packages/interpretation-contract \
  packages/anchor-layer
git fetch --depth 1 origin "${OPEN_TWIN_SHA}"
git checkout "${OPEN_TWIN_SHA}"
GOT="$(git rev-parse HEAD)"
if [[ "${GOT}" != "${OPEN_TWIN_SHA}" ]]; then
  echo "sync-open-twin FAIL: HEAD is ${GOT}, expected ${OPEN_TWIN_SHA}" >&2
  exit 1
fi

# Standalone installs cannot resolve monorepo workspace:* protocol.
for pkg in fhir-r4 provider-oura provider-google-health provider-whoop provider-vitronic; do
  python3 - <<PY
from pathlib import Path
p = Path("packages/${pkg}/package.json")
text = p.read_text()
if '"workspace:*"' not in text and "'workspace:*'" not in text:
    raise SystemExit(0)
p.write_text(text.replace('"workspace:*"', '"file:../fhir-core"'))
print(f"rewrote workspace:* -> file:../fhir-core in {p}")
PY
done

# generate lives at the monorepo root (not in this sparse checkout);
# src/generated is already committed. Rewrite build to tsup only.
python3 - <<'PY'
import json
from pathlib import Path
p = Path("packages/interpretation-contract/package.json")
data = json.loads(p.read_text())
data.setdefault("scripts", {})["build"] = "tsup src/index.ts --format esm --dts"
p.write_text(json.dumps(data, indent=2) + "\n")
print(f"rewrote build to tsup-only in {p}")
PY

build_pkg() {
  local name="$1"
  echo "=== build ${name} ==="
  (
    cd "${DEST}/packages/${name}"
    bun install
    bun run build
  )
}

build_pkg fhir-core
build_pkg fhir-r4
build_pkg provider-oura
build_pkg provider-google-health
build_pkg provider-whoop
build_pkg provider-vitronic
build_pkg interpretation-contract
# anchor-layer: TwinLLM imports only its data/ JSON export (the loader uses node:fs).
build_pkg anchor-layer

# Host file: installs must not nest file: fhir-core (Turbopack cannot parse bun
# symlink redirects for package.json). Move fhir-core to peerDependencies so the
# root file: fhir-core is hoisted, then drop package-local node_modules/bun.lock
# so they are not copied into the host tree.
FHIR_VERSION="$(python3 -c "import json; print(json.load(open('${DEST}/packages/fhir-core/package.json'))['version'])")"
# fhir-r4 keeps file:../fhir-core — @open-twin/fhir-core@0.1.0 is not on npm.
# provider-vitronic keeps file:../fhir-core in dependencies so the first host
# bun install can resolve it without hitting registry.npmjs.org (404).
for pkg in provider-oura provider-google-health provider-whoop; do
  python3 - <<PY
import json
from pathlib import Path
p = Path("${DEST}/packages/${pkg}/package.json")
data = json.loads(p.read_text())
deps = data.setdefault("dependencies", {})
deps.pop("@open-twin/fhir-core", None)
peers = data.setdefault("peerDependencies", {})
peers["@open-twin/fhir-core"] = "${FHIR_VERSION}"
p.write_text(json.dumps(data, indent=2) + "\n")
print(f"peer-pinned @open-twin/fhir-core@${FHIR_VERSION} in {p}")
PY
done

for name in "${PACKAGES[@]}"; do
  rm -rf "${DEST}/packages/${name}/node_modules" "${DEST}/packages/${name}/bun.lock"
done

echo "${OPEN_TWIN_SHA}" > "${DEST}/OPEN_TWIN_SHA"
echo "sync-open-twin OK: ${DEST} @ ${OPEN_TWIN_SHA}"
