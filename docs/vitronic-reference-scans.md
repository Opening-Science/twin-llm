# BodyLoop reference scans

The BodyLoop scanner moves on 15 December 2026. Before it does, a fixed set of
reference scans is recorded at the current site, so scans made after the move,
and open-anatomy's scan enhancement, can be compared against the same people
on the same scanner. Issue #613 covers the sync; this page is #614.

Scans of people never go to GitHub, CI, issues, pull requests, screenshots or
renders. This page and its checklist are the only part in git. The set itself
lives on the operator's machine.

## What the set holds

| Part             | What                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Reference people | Each one a `VitronicSubject` with consent recorded (`consentRecordedAt`, `consentBy`, `consentNote`) and a label that is not a name |
| Repeat scans     | Several scans of each person in one session, without leaving the scanner, so repeatability before the move is known                 |
| Presets          | The presets the scanner offers today, each scanned at least once, with the preset name the viatar records                           |
| Per scan         | The mesh (`.glb`) and the five measure lists (heights, distances, angles, cross-sections, axes) plus markers and properties         |

How many people and how many repeats is decided before the session (see the
checklist); the table above is what each of them needs.

## Where it is stored

- Every scan is synced into TwinLLM on the operator's machine (Digital Twin →
  subject → Sync). The mesh lands in gitignored `data/vitronic/<userId>/<sha256>.glb`
  (or `VITRONIC_DATA_DIR`); the measures in `VitronicSnapshot`
  ([vitronic.md](vitronic.md)). In personal mode both are sealed with the
  owner's keys, and the mesh file is then `<sha256>.glb.enc`.
- A copy of the scanner's own export goes to the same machine's encrypted disk,
  outside every git checkout.
- Nothing is uploaded anywhere else.

## The list

The list is what makes the set usable after the scanner has moved: one row per
scan, kept as `data/vitronic/reference-scans.csv` on the operator's machine,
inside the folder git already ignores. It holds identifiers only, never measure
values:

| Column          | From                                                      |
| --------------- | --------------------------------------------------------- |
| `reference`     | A running number, `R01`, `R02`, …                         |
| `subject_label` | `VitronicSubject.label` (not a name)                      |
| `consent`       | `consentRecordedAt` and `consentBy`                       |
| `viatar_id`     | The scanner's scan number                                 |
| `scanned_at`    | `Viatar.meta.crtime`                                      |
| `preset`        | `presetName`                                              |
| `repeat`        | 1, 2, 3 … within one person's session                     |
| `glb_sha256`    | `VitronicSnapshot.glbSha256`                              |
| `complete`      | Mesh and markers both stored (`synced`, not `incomplete`) |
| `note`          | Anything unusual: a movement, a re-scan, a preset change  |

## Checklist

Before the session:

- [ ] Number of reference people and repeats per person agreed
- [ ] Consent recorded for each person in TwinLLM before their first scan
- [ ] Labels chosen; none is a name
- [ ] Scanner reachable from the operator's machine; `bun run vitronic:connect` done and the TLS pin stored
- [ ] Enough free disk for the meshes (25–60 MB each)

During the session:

- [ ] Each scan synced in Digital Twin and shown as synced, not incomplete
- [ ] Each scan's row added to the list straight away
- [ ] Repeat scans of a person made without leaving the scanner

Before 15 December:

- [ ] Every row's `glb_sha256` matches a file under `data/vitronic/` (`.glb` or `.glb.enc`)
- [ ] The scanner's own export copied to the encrypted disk
- [ ] The list and the set backed up together, off GitHub
- [ ] #614 closed with the number of people and scans only, no labels or ids

After the move:

- [ ] The first scans at the new site are compared against the list, person by
      person, before anything else changes
