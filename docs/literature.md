# Specialty literature

Each agent (#210) is meant to read and cite its own body of published medical
literature. This page lists the open sources we checked, what their licences
allow, and how `bun run literature:fetch` and `bun run literature:ingest` put
open-licence articles into the local search index with a specialty tag. It is
reference material for research, not clinical advice, and nothing here is
legal advice. Issue #220.

## How to read the tables

- **Store locally**: may we keep a full-text copy on the operator machine
  (gitignored `data/literature/`) and embed it into the local pgvector index.
- **Quote**: may the app show a verbatim passage with a citation.
- **Train**: may the text be used to train or fine-tune a model. We are
  conservative here. Only CC0, CC BY and US federal public domain text count
  as yes. Share-alike (SA) is "review first", because a trained model could be
  argued to be an adaptation that would have to carry the same licence.
  NonCommercial (NC) and NoDerivatives (ND) are never training data.
- **Verified** means we read the licence on the publisher's own page or data
  file on 2026-10-28; the URL is given. **Unverified** means we could not read
  the source page itself, and the row says why.

NC licences are fine for Open Science Foundation research use. As with the
guideline corpus (`docs/guidelines.md`), NC rows must be removed before any
commercial use. ND text may be stored and quoted verbatim with a citation; it
must not be edited, summarised into a new work that is shipped, or trained on.

## Sources and licences

| Source                                                   | Licence                                                                                                         | Store locally                        | Quote                                       | Train                                           | Status                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------- | ----------------------------------------------- | ---------------------- |
| PMC Open Access Subset, commercial-use group             | per article: CC0, CC BY, CC BY-SA, CC BY-ND                                                                     | yes                                  | yes, with citation                          | CC0 and CC BY yes; BY-SA review first; BY-ND no | verified [1][2][3]     |
| PMC Open Access Subset, non-commercial group             | per article: CC BY-NC, CC BY-NC-SA, CC BY-NC-ND                                                                 | yes (research only)                  | yes, with citation, non-commercial          | no                                              | verified [1][2][3]     |
| PMC author manuscripts (`license_code` `TDM`)            | text mining, plus fair use under copyright law                                                                  | no (the fetch skips them)            | no                                          | no                                              | verified [3]           |
| Europe PMC open access subset                            | per article, Creative Commons or similar, terms differ by article                                               | same rules as PMC, per article       | same rules as PMC                           | same rules as PMC                               | verified [4]; see note |
| NCBI Bookshelf, StatPearls                               | CC BY-NC-ND 4.0                                                                                                 | yes (research only), not fetched yet | yes, verbatim with citation, non-commercial | no                                              | partly verified [5]    |
| MedlinePlus, NLM-authored pages (incl. Genetics)         | US federal work, public domain; NLM asks for credit                                                             | yes                                  | yes, with credit to MedlinePlus/NLM         | yes                                             | verified [6]           |
| MedlinePlus, A.D.A.M. encyclopedia, ASHP drug monographs | copyrighted, licensed to NLM                                                                                    | no                                   | link only                                   | no                                              | verified [6]           |
| WHO publications                                         | CC BY-NC-SA 3.0 IGO                                                                                             | yes (research only)                  | yes, with citation, non-commercial          | no                                              | verified [7]           |
| USDA FoodData Central                                    | CC0 1.0, public domain                                                                                          | yes                                  | yes; USDA asks for credit                   | yes                                             | verified [8]           |
| Dietary Guidelines for Americans (DietaryGuidelines.gov) | public domain text; credit USDA and HHS and link the site; some photos and other material are not public domain | text yes; photos no                  | yes, with credit and link                   | text yes; photos no                             | verified [9]           |
| OpenStax Anatomy and Physiology (1st edition)            | CC BY 4.0                                                                                                       | yes                                  | yes, with attribution                       | yes                                             | verified [10]          |
| OpenStax Anatomy and Physiology 2e                       | CC BY-NC-SA 4.0 (not CC BY)                                                                                     | yes (research only)                  | yes, with attribution, non-commercial       | no                                              | verified [10]          |
| OpenStax Nutrition for Nurses                            | CC BY-NC-SA 4.0                                                                                                 | yes (research only)                  | yes, with attribution, non-commercial       | no                                              | verified [10]          |

Notes:

- **PMC.** The Open Access Subset is defined article by article: "License
  terms vary", and the licence statement in each article decides [1]. The PMC
  Article Datasets put a `license_code` on every article version's JSON
  metadata: a Creative Commons code, or `TDM` for author manuscripts [3].
  Users must acknowledge NLM as the source, must not imply NLM endorsement,
  and may only redistribute data licensed for redistribution [3]. Automated
  retrieval is allowed only through the PMC Cloud Service, OAI-PMH,
  E-utilities and the BioC API [1]. In 2026 NLM retired the FTP service and
  the OA Web Service; E-utilities and the Cloud Service remain [11].
- **E-utilities.** NCBI asks for no more than three requests per second
  without an API key, and for large jobs on weekends or between 9 pm and 5 am
  US Eastern time. `tool` names the software and `email` is the developer's
  address, not an end user's [12]. The NCBI page served a bot check to our
  fetch, so this is from NCBI's own text as quoted in search results.
- **Europe PMC.** The subset page says licences differ by article and are
  stated on each article [4]. Its REST search was unavailable (HTTP 503) when
  we tried, so the per-article licence field there is not checked yet. The
  fetch below uses PMC only.
- **StatPearls.** The CC BY-NC-ND 4.0 statement was read from NCBI-hosted
  StatPearls pages through search results; the Bookshelf copyright page served
  a bot check [5]. StatPearls is listed in the Bookshelf open access file list
  for the LitArch service [13]. Not fetched by this tool; a later step should
  re-read the licence on the downloaded package before use.
- **WHO.** Adaptations and translations need WHO's disclaimer and the same or
  a similar licence; commercial use needs WHO's permission [7].
- **OpenStax.** The licence differs by edition: the first edition of Anatomy
  and Physiology is CC BY 4.0, the second edition is CC BY-NC-SA 4.0 [10]. Use
  the first edition when a training-safe anatomy text is needed.

Not checked and not used: society sleep and exercise guidelines (for example
AASM or ACSM), GeneReviews, and the HHS Physical Activity Guidelines. Regard
them as copyrighted until someone reads their terms.

## Per specialty

Every specialty can draw on the PMC Open Access Subset through the fetch tool,
with the per-article rules above. The MeSH query each one uses is in
`packages/literature/specialties.ts`.

| Specialty (id)        | PMC query (MeSH, open access only)                                    | Other sources                                                                                   | Training-safe set                                        |
| --------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| General (`gp`)        | primary health care, general practice                                 | MedlinePlus NLM-authored health topics; StatPearls (NC-ND, quote only); WHO (NC-SA, quote only) | PMC CC0/CC BY, MedlinePlus NLM-authored                  |
| Diet (`diet`)         | diet, nutritional physiological phenomena                             | FoodData Central (CC0); Dietary Guidelines text (public domain); Nutrition for Nurses (NC-SA)   | PMC CC0/CC BY, FoodData Central, Dietary Guidelines text |
| Anatomy (`anatomy`)   | anatomy                                                               | OpenStax A&P 1st edition (CC BY); 2e is NC-SA                                                   | PMC CC0/CC BY, OpenStax A&P 1st edition                  |
| Sleep (`sleep`)       | sleep, sleep wake disorders                                           | MedlinePlus NLM-authored sleep topics                                                           | PMC CC0/CC BY, MedlinePlus NLM-authored                  |
| Trainer (`trainer`)   | exercise, sports, physical fitness                                    | MedlinePlus NLM-authored exercise topics                                                        | PMC CC0/CC BY, MedlinePlus NLM-authored                  |
| Genetics (`genetics`) | genetics medical, pharmacogenetics, genetic predisposition to disease | MedlinePlus Genetics (public domain)                                                            | PMC CC0/CC BY, MedlinePlus Genetics                      |

What may be stored, quoted and trained on is decided per article by its
licence, not per specialty. Only PMC is wired into the fetch today; the other
sources are listed so the next step knows what is allowed.

## Fetch

```bash
bun run literature:fetch -- --specialty diet --limit 50
bun run literature:fetch -- --specialty sleep --limit 3 --dry-run
bun run literature:fetch -- --specialty diet --allow cc0,cc-by   # training-safe only
bun run literature:fetch -- --specialty gp --query '"hypertension"[mesh]'
```

1. Searches PMC through E-utilities `esearch` with the specialty's MeSH query
   and `"open access"[filter]`, asking for three times `--limit` hits, since
   some are skipped.
2. For each hit, lists its versions in the PMC Article Datasets bucket
   (`pmc-oa-opendata`) and reads the newest version's JSON metadata.
3. Skips the article unless it is in the Open Access Subset, not retracted,
   and its `license_code` is one of the allowed licences: by default every
   Creative Commons licence, narrowed with `--allow`. `TDM` and a missing code
   are always skipped. Each skip is printed with its reason.
4. Reads the plain text and writes `data/literature/<specialty>/<pmcid>.<version>.txt`
   and a `.json` record with the licence, the raw `license_code`, the citation,
   the DOI, the PMC URL, the query and the time. Articles already stored are
   skipped, so a re-run continues where it stopped.

Requests are sequential, one every 400 ms at most, which is under NCBI's three
per second. `tool=twinllm` is always sent. `--email` adds the `email`
parameter; use the developer's own address. No API key is used.
`--dry-run` reads metadata and writes nothing. `--limit` is 1 to 500, default 20. `LITERATURE_DATA_DIR` moves the folder.

`data/literature/` is gitignored. Never commit downloaded text. Credit NLM
wherever the text is shown.

## Ingest

```bash
bun run literature:ingest
bun run literature:ingest -- --specialty diet
```

Reads the records, checks each licence again, and writes into the guideline
tables like the knowledge notes do (`docs/knowledge.md`), with local
`nomic-embed-text` embeddings and no cloud fallback:

- `guideline_documents.source` is `literature:<specialty>`, so a search can be
  limited to one agent's literature with the existing source filter
  (`queryNearestChunks(db, embedding, k, "literature:diet")`). No migration
  was needed.
- One document per specialty and article version, id
  `lit-<specialty>-<pmcid>.<version>`. Title, year and journal come from the
  PMC citation; `licence` is the normalised licence (`cc-by`, `cc-by-nc-nd`,
  ...); `url` is the PMC article page.
- The PMC text's front matter (journal and article information, author names,
  affiliations and contact emails) and everything from the reference list on
  are dropped before chunking, so no author address is embedded. Headings
  become sections for the guideline chunker. A file whose front matter cannot
  be told apart from the body is skipped.
- A failed embedding stops the run before anything is written for that
  article. Articles whose files were removed are pruned, only within the
  specialties being ingested.

## Search (#236)

On an agent's turn `knowledge_search` reads the OpenTwin notes plus that agent's
`literature:<specialty>` source; the General agent reads every specialty. A plain
model reads the notes alone, as before. Every literature hit gives the article title, PMC
id and licence, an attribution line ending "via PubMed Central (NLM)", and a quoting
rule: word for word only, with the attribution; for CC BY-ND and CC BY-NC-ND, never
shortened, reworded or translated. Literature is reference material and never counts as
evidence about the person. Details in [agents.md](agents.md#literature-236).

### First local run (2026-10-29)

`literature:fetch -- --specialty <id> --limit 5` for diet, anatomy and sleep stored 5
articles each (15 searched each, none skipped): 7 CC BY and 8 CC BY-NC-ND. The ingest wrote
15 documents and 443 chunks (diet 135, anatomy 154, sleep 154). One search per agent, `k`
8, read-only, no audit row:

| Agent   | Query                                  | Hits | From                   |
| ------- | -------------------------------------- | ---- | ---------------------- |
| diet    | dietary fibre intake and blood glucose | 8    | 8 `literature:diet`    |
| anatomy | anatomical variation of blood vessels  | 8    | 8 `literature:anatomy` |
| sleep   | sleep duration and insomnia            | 8    | 8 `literature:sleep`   |
| gp      | sleep duration and insomnia            | 8    | 8 `literature:sleep`   |

The local database had no OpenTwin notes ingested, so this run says nothing about how
notes and literature rank against each other. With five articles a specialty, the nearest
passages are often off topic (the first anatomy hit was from a neuroblastoma imaging paper);
the counts show the filter works, not that the corpus is useful yet.

## Sources

1. PMC Open Access Subset: https://pmc.ncbi.nlm.nih.gov/tools/openftlist/
2. PMC Article Datasets on AWS (licence groups): https://pmc.ncbi.nlm.nih.gov/tools/pmcaws/
3. PMC Article Datasets README (`license_code`, `TDM`, terms): https://pmc-oa-opendata.s3.amazonaws.com/README.txt
4. Europe PMC open access subset: https://europepmc.org/downloads/openaccess
5. StatPearls on NCBI Bookshelf: https://www.ncbi.nlm.nih.gov/books/NBK430685/
6. Using MedlinePlus content: https://medlineplus.gov/about/using/usingcontent/
7. WHO copyright and licensing: https://www.who.int/about/policies/publishing/copyright
8. FoodData Central API guide (CC0 statement): https://fdc.nal.usda.gov/api-guide/
9. DietaryGuidelines.gov policy and links: https://www.dietaryguidelines.gov/policy-and-links
10. OpenStax book licences (CMS API): https://openstax.org/apps/cms/api/v2/pages/?type=books.Book&fields=title,license_name,license_url&limit=200
11. PMC dataset distribution changes, 2026: https://ncbiinsights.ncbi.nlm.nih.gov/2026/02/12/pmc-article-dataset-distribution-services/
12. E-utilities usage guidelines: https://www.ncbi.nlm.nih.gov/books/NBK25497/
13. NCBI Bookshelf open access file list: https://ftp.ncbi.nlm.nih.gov/pub/litarch/file_list.csv
