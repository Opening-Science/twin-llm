# Source attribution study harness (P6, #508)

The harness for the study "Which device said so?": local models answer
questions about one synthetic person's wearable readings from several
sources, and the scorer checks whether each stated number's citation names
the reading the number came from. Design and pre-registration live in the
research plan (P6); this page says what the code does. Synthetic data only;
nothing here reads a person's rows or reaches a database.

## Items: W1 and the development set

`bun run attribution:w1` writes item set W1 (`--set dev` the development set)
to `.attribution-study/<set>-seed<seed>/` (gitignored): `items.json` and
`manifest.json`, which records the generator, seed, quotas, the error model
(marked assumed) and the SHA-256 of `items.json`, the hash a registration
records. Code: `scripts/synthetic-wearables/w1-items.ts`.

| Stratum              | W1  | Dev | What is true on the asked day                                      |
| -------------------- | --- | --- | ------------------------------------------------------------------ |
| `single_source`      | 32  | 8   | one source, the only one the person wears                          |
| `agree`              | 64  | 16  | two or three sources within the rules' tolerance                   |
| `disagree`           | 64  | 16  | two or three sources beyond it                                     |
| `day_shift`          | 48  | 12  | one source has the day; another only the days next to it           |
| `missing`            | 32  | 8   | no source has the day; some have the days next to it               |
| `construct_mismatch` | 24  | 6   | probe: Oura Readiness against WHOOP Recovery, two different scores |

Each person has three core items from three strata (80 people in W1, 20 in
the development set, on another seed). Every item asks about resting heart
rate or HRV, the two measures the rules compare that P6 also lists. Each item
holds the asked day and the day before and after, per source.

- **Values.** A latent value per day from a person's level, plus a
  per-source bias and noise (`ERROR_MODEL`, assumed, not from the accuracy
  review). The stratum then sets the asked day's gap against the app's own
  tolerance (`SOURCE_TOLERANCE`): within half of it to agree, 1.5 to 3 times
  it to disagree.
- **Identifiability.** No two readings of an item are shown as the same
  number (`confusableCells`). The readings of the days next to the asked day
  are moved by whole units until none collides; the asked day's readings,
  which carry the stratum, never move. An item that still fails is drawn
  again, at most 50 times, and the manifest counts the items that needed a
  redraw.
- **Rule.** `fixed_order` (Oura, WHOOP, Google Health: state the first that
  has the day and name the others) or `hold_back` (withhold when the
  sources disagree beyond the tolerance, else as fixed order). Half of each
  stratum gets each rule, by a seeded shuffle.
- **Listing order.** The order the prompt lists the sources in is a seeded
  permutation drawn apart from the rule.
- **Expected answer.** `state` (the reading, its source and day, the other
  sources), `withhold`, `abstain` or, for a probe, `distinguish`.
