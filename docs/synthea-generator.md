# Synthea generator

TwinLLM can make synthetic patient records with
[Synthea](https://github.com/synthetichealth/synthea), the open-source patient
simulator from The MITRE Corporation. Every record is invented by the
simulation: a whole life of visits, conditions, medications, procedures and
measurements for a person who does not exist. The records are for research and
software testing only.

There are two ways to use it:

1. **From the repository**, with `bun run synthea:generate`, for any size from
   10 people to the 1M cohort.
2. **On the generator page**, `/synthea` in the app or
   [synthea.opening.science](https://synthea.opening.science), for 1 to a few
   dozen people at a time, downloaded as one zip.

Both run the same pinned Synthea: v4.0.0, `synthea-with-dependencies.jar`,
SHA-256 `ed43c20ad40ba5c3bc724503a5af032715fe3c491620b766148e7c2361e6ecc1`.

## Synthea runs on a server, not in the browser

Synthea is a Java program. A web page cannot run Java, so the generator page
does not make the records in your browser. It sends your choices to the
server, the server runs the JAR in a temporary folder, and the page downloads
the result. The server needs Java 21 or newer and the JAR.

## Path 1: from the repository

You need Java 21+, `curl` and the repository with `bun install` done. The
first run downloads the JAR to `.synthea/cache/` and checks its SHA-256.

```bash
# 10 people, seed 42, ages 40–75 → .synthea/fhir (the evaluation cohort's folder)
bun run synthea:generate

# 10 people of any age with your own seed → .synthea/synthea-v4-seed7/fhir
bun run synthea:generate -- --population 10 --seed 7

# 1,000 people: the held-out cohort, seed 9001, ages 40–75
bun run synthea:generate -- --preset held-out

# 1,000 people with your own seed and ages
bun run synthea:generate -- --population 1000 --seed 123 --age 18-90

# See what a run would do without running it
bun run synthea:generate -- --preset training --dry-run
```

The script writes FHIR R4 bundles, one JSON file per person, and a
`manifest.json` with the seeds, dates, Synthea version and a checksum of the
files. It always runs Java in UTC with one generator thread and ends every
record on 1 January 2026, so the same options and seed give the same files
byte for byte. Options and presets are listed at the top of
`scripts/synthea/generate-local.sh` and in
[training-data.md](training-data.md).

### The 1M cohort

The 1M cohort is 100 batches of 10,000 people, seeds 1001 to 1100, clinician
seed = seed + 1000, all ages, Massachusetts ([training-data.md](training-data.md),
"The 1M cohort"). To make batches like them with the script:

```bash
for seed in $(seq 1001 1100); do
  SYNTHEA_CLINICIAN_SEED=$((seed + 1000)) \
    bun run synthea:generate -- --population 10000 --seed "$seed"
done
```

Each batch goes to `.synthea/synthea-v4-seed<seed>/fhir`. Synthea also writes
the people who died during the simulation, so a batch has about 11,500 files.
On one machine in October 2026, one batch on one generator thread took about
75 minutes and packed to about 870 MB as `tar.zst`; run several batches side
by side in separate shells to use more cores. The published batches were made
before the script fixed the end date, so these runs do not reproduce them byte
for byte.

### The supplementary S7 cohort

`bun run synthea:s7` makes the small evaluation cohort `synthea-v4-s7` (#277):
three runs of the same JAR with fixed seeds, each with a keep module in
`scripts/synthea/keep/` that keeps only people whose record has atrial
fibrillation, atrial fibrillation and a stroke, or no atrial fibrillation, and
a narrowed module list. Keep modules are Synthea's own way to generate until a
given number of people match. The recipe and checksums are in
`evaluation/cohorts/synthea-v4-s7.manifest.json`;
[question-set.md](evaluation/question-set.md), "S7b", has the details.

## Path 2: the generator page

Open `/synthea` (in the app) or the root of synthea.opening.science. Choose:

| Option           | Values                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| Number of people | 1 to 50 on the hosted site (`SYNTHEA_MAX_PEOPLE`)                                                         |
| Seed             | Optional whole number. Empty picks one; the result shows it                                               |
| Ages             | Lowest and highest age, 0 to 100                                                                          |
| Sex              | Any, female only, male only                                                                               |
| US state         | One of the 50 states or the District of Columbia; Synthea's population data covers the United States only |
| Modules          | None (every Synthea module) or some of a fixed list of ten disease modules                                |
| Output           | FHIR R4 bundles, CSV tables, or both                                                                      |

Picking modules runs only those, plus check-ups (`wellness_encounters`),
allergies and medication review, so the records still have vital signs and lab
panels. Synthea's built-in Java modules (life course, cardiovascular disease,
quality of life) always run.

Generate queues a job. The page shows its place in line, then how many people
are done, then a download button and a short preview of one generated person:
counts of conditions, observations, encounters, medication requests,
procedures and immunizations, the first conditions and the latest
measurements. The zip holds `fhir/` and `csv/` as chosen, `manifest.json` with
the options and seeds, and a `README.txt` with the Synthea credit.

Like the script, every run ends on 1 January 2026 in UTC with one thread, so
the same options and seed give the same people again.

### How a run is made safe

- The options are a closed set, checked by one zod schema
  (`features/synthea/synthea-options.ts`) on the page and again on the server;
  unknown fields are refused.
- The Java command line is built from those checked values only
  (`features/synthea/synthea-args.ts`): numbers, and names looked up in the
  code's own tables. Nothing typed by a person reaches it. Java is started
  without a shell and gets only `PATH`, `TZ` and `LANG` in its environment.
- One job runs at a time; up to `SYNTHEA_QUEUE_MAX` wait. A run that passes
  `SYNTHEA_JOB_TIMEOUT_S` is stopped.
- Each job has its own temporary folder. It is deleted when the zip is
  downloaded (once), 10 minutes after the run if nobody downloads it, or when
  the run fails or is stopped. Nothing is stored anywhere else.
- Each address may start `SYNTHEA_JOBS_PER_HOUR` runs an hour. The address is
  `X-Real-IP`, else the last `X-Forwarded-For` hop.
- A browser request from another site cannot start a run (`Sec-Fetch-Site`).

The data is synthetic, so there is no personal data to protect, but the server
still keeps no copy of it.

### Settings

| Variable                | Default                                        | What                                      |
| ----------------------- | ---------------------------------------------- | ----------------------------------------- |
| `SYNTHEA_HOST`          | `synthea.opening.science`                      | The host that serves only the generator   |
| `SYNTHEA_MAX_PEOPLE`    | `50`                                           | People per run (1 to 1,000)               |
| `SYNTHEA_JOB_TIMEOUT_S` | `180`                                          | Longest run, in seconds (10 to 1,800)     |
| `SYNTHEA_JOBS_PER_HOUR` | `12`                                           | Runs per address per hour                 |
| `SYNTHEA_QUEUE_MAX`     | `5`                                            | Jobs that may wait behind the running one |
| `SYNTHEA_JAR`           | `.synthea/cache/synthea-with-dependencies.jar` | The pinned JAR; its SHA-256 is checked    |
| `SYNTHEA_JAVA`          | `java` on `PATH`                               | The Java 21+ binary                       |

Without the JAR, the page says the generator is not set up. Run
`bun run synthea:generate` once to download it, or set `SYNTHEA_JAR`.

The queue and the per-address counts live in the server process, so run the
hosted generator as one process.

## Deploying at synthea.opening.science

Nothing is deployed yet. The steps:

1. **A server** with Java 21+, Bun and this repository at a release commit.
   Run `bun install --frozen-lockfile`, then `bun run synthea:generate` once
   (10 people) so the JAR is downloaded and checked, or copy the JAR to the
   path in `SYNTHEA_JAR`; the server checks its SHA-256 before the first run.
2. **Environment.** The app checks its usual settings at start
   (`.env.example`), including `DATABASE_URL`. For a server that only serves
   the generator, the lightest set is auth off with the production override:
   `LOCAL_MVP=true`, `ALLOW_AUTH_DISABLED_IN_PRODUCTION=true`,
   `LOCAL_ONLY=true`, `LLM_PROVIDER=ollama`, and a `DATABASE_URL` (the
   generator does not use the database). With auth off, `proxy.ts` refuses
   every request that is not for `SYNTHEA_HOST` unless it comes from the
   machine itself, so the rest of TwinLLM is not reachable from outside.
   Set the `SYNTHEA_*` values above as needed.
3. **Build and start**: `bun run build`, then `bun run start` (listens on
   127.0.0.1:3000).
4. **Reverse proxy** (Caddy or nginx) on the same machine, terminating TLS for
   synthea.opening.science and forwarding to 127.0.0.1:3000. It must pass the
   original `Host` header and set `X-Real-IP` to the client address (nginx:
   `proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr;`;
   Caddy's `reverse_proxy` passes `Host` and sets `X-Forwarded-For`).
5. **DNS**: an `A` (and `AAAA`) record for synthea.opening.science pointing at
   the server.
6. **Check**: `https://synthea.opening.science/` shows the generator,
   `/docs` this page, and any other path (for example `/start`) answers 404.
   Make one run of 2 people and download it.

On that host, `/` serves `/synthea`, `/docs` serves `/synthea/docs`, the job
API `/api/synthea/...` answers, and every other path is "Not found"
(`features/synthea/synthea-host-route.ts`). Requests for any other host name
reach the app as before.

## Licence and credit

Synthea is © The MITRE Corporation and contributors, licensed under the
Apache License 2.0. TwinLLM does not ship the JAR; it downloads the release
and checks its checksum. The generator page, the zip's `README.txt` and
`NOTICE` credit Synthea. The generated records are synthetic. They describe no
real person and are for research and software testing, not clinical use.
