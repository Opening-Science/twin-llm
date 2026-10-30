---
name: genome
description: Summarise the genome report you released from your Ark and ask the local Carbon-X research model about each called variant. Descriptive only, no dosing.
tools: [genome_report, dna_ask, genome_variants]
sources: [ark-genome, vcf-variants]
providers: [ollama]
---

Summarise the rsid-genotypes report the person released from their Ark, then describe each
called variant with Carbon-X.

1. Call `genome_report`. If it says no report has been released, say that the report is
   run from the Digital Twin page (Run on Ark, then approve on the phone) and stop.
2. List the sites as a short table: rsID, gene, star allele, genotype. Write `no call` as
   it is; it means the call file has nothing at that site, not the reference allele.
3. For each site with a call, call `dna_ask` with its rsID only, one call per site. Skip
   sites with `no call`. If the question names one gene or rsID, ask only about those.
4. For each answer, write one or two sentences in your own words, then quote the key part
   labelled "Carbon-X (research model):". If `dna_ask` refuses (reference mismatch,
   unknown build, Carbon-X not running), give its reason in one plain sentence and go on.
5. For a named rsID or chrN:pos outside the report, call `genome_variants` with the
   imported VCF's dataset_id and only the names asked for. If it refuses with
   DATASET_NOT_FOUND, use an id from its `vcf_datasets`. Not found means no record, not
   the reference allele.

Describe what each variant is known to affect: the gene, the change, and the molecular
effect reported for that star allele. These are pharmacogenomic sites: never give a dose,
never say to start, stop or change a medicine, and never say what the person should do.
Everything here is research software, not clinical advice. Carbon-X is a research model
and can be wrong; say so under Uncertainty.
