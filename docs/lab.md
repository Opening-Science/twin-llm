# Lab

`/lab` (Lab in the sidebar) is one place to see what runs on this machine and to check it. Closed
cloud health apps describe their privacy and attestation, but nobody outside can repeat the check.
TwinLLM runs locally, so each claim it makes about itself can be tested here and then repeated by
hand with the command on the card.

The page has sections. Verifiability is the first; Simulations and Results are planned as later
sections of the same page. Research use only: nothing on the page is about anyone's health.

## Verifiability

Each check runs on the server when the page loads (`features/lab/run-lab-checks.ts`) and hands what
it found to a pure function that decides the status (`features/lab/*-check.ts`, each with a test).
A card says OK, Not OK or Unknown in words, shows the evidence, and gives a shell command that
repeats the check without the app. A check that cannot run shows Unknown with a plain sentence; the
reason goes to the server log only.

| Check                      | What it proves                                                                                                                                                                                                        | What it does not prove                                                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local only                 | Whether `LOCAL_ONLY` is on, the chat provider, and for each configured service (chat models, Carbon-X, GBD, PostHog, Clerk, Arcjet) whether it runs on this machine. Names and switches only; no key or URL is shown. | That nothing else leaves the machine. Wearable syncs still download from each vendor's cloud ([providers.md](providers.md#local-only-mode)), and the check reads the configuration, not the network.              |
| Audit chain                | `verifyChain()` recomputes every row's hash in order and checks each row points at the one before. Shows rows checked, the first broken row and the newest row's hash.                                                | Removing the newest rows leaves a shorter chain that still holds. Note the latest hash and compare it later to catch that. Someone with write access to the database can also rebuild the whole chain.            |
| Local models               | The models Ollama lists at `OLLAMA_BASE_URL` (`/api/tags`), with digest, size and family, and whether that address is this machine. The digest's start is the ID `ollama list` prints.                                | Where the weights came from, or that they are the published ones. The digest identifies what Ollama holds; compare it with the registry yourself.                                                                 |
| Pinned artefacts           | SHA-256 of the Synthea JAR, the evaluation cohort archive (`eval-cohort-v1`) and the seven anatomy files, against the pins in `infrastructure/local-artefacts.ts` and `packages/anatomy/`. Missing files are listed.  | That the pins themselves are right; they are recorded in `PROVENANCE.md` and the release notes. A rigged body baked on this machine may differ in the last bits of a float, so a different hash there is Unknown. |
| Provenance                 | The app version and git commit written in at build time (`next.config.ts`), whether the build had uncommitted changes, and the open-twin pin in `PROVENANCE.md` against `.open-twin/OPEN_TWIN_SHA`.                   | That the running code is that commit beyond what the build recorded. A build from a changed working tree says so and stays Unknown.                                                                               |
| Software bill of materials | Whether `bun run sbom` has written `.sbom/twin-llm.cdx.json`, its component count and SHA-256, and whether it is byte for byte what the current `bun.lock` gives.                                                     | That the packages are free of known flaws. Feed the file to a scanner of your choice for that.                                                                                                                    |

None of this is remote attestation. Every check is this machine reporting on itself, so it shows a
careful person what to look at and how to repeat it; it cannot prove anything to someone who does
not trust the machine. The audit check reads the whole table on each load, which is fine for a local
database and slow for a very large one.

## Commands

```bash
# Audit chain, the same walk the page runs (read-only)
bun --env-file=.env.local packages/audit/verify-cli.ts --check

# Software bill of materials (CycloneDX 1.6 JSON, gitignored)
bun run sbom
sha256sum .sbom/twin-llm.cdx.json

# Models and pinned files
ollama list
sha256sum .synthea/cache/synthea-with-dependencies.jar data/anatomy/*.glb
```

## SBOM

`bun run sbom` (`scripts/sbom/write.ts`, `infrastructure/cyclonedx.ts`) reads `bun.lock` and
`package.json` and writes CycloneDX 1.6 JSON with no extra tool. Every package the lockfile
resolves is listed once, with its package URL and the lockfile's integrity hash as hex SHA-512. The
open-twin packages are local `file:` packages with no registry hash; their path is kept as a
property. The file has no timestamp or serial number, so the same lockfile always gives the same
bytes. The lockfile covers development tools as well as what the app ships, so the list is longer
than the running app needs.
