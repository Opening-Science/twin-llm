//! Every panel site in the fixtures and goldens is forward-strand GRCh38.
//!
//! `GRCH38` is the panel slice of `scripts/genome-synth/variants.tsv`
//! (Ensembl release 116 / dbSNP 156). When that catalog is in the checkout,
//! the table must equal its `panel` rows exactly. On a real run the Ark's own
//! variant catalog is authoritative; this only keeps the test data honest.

use std::fs;
use std::path::{Path, PathBuf};

use rsid_genotypes::PANEL;

/// rsid, chromosome, position, reference, alternate (forward strand).
const GRCH38: &[(&str, &str, &str, &str, &str)] = &[
    ("rs4244285", "chr10", "94781859", "G", "A"),
    ("rs4986893", "chr10", "94780653", "G", "A"),
    ("rs12248560", "chr10", "94761900", "C", "T"),
    ("rs1799853", "chr10", "94942290", "C", "T"),
    ("rs1057910", "chr10", "94981296", "A", "C"),
    ("rs3892097", "chr22", "42128945", "C", "T"),
    ("rs1065852", "chr22", "42130692", "G", "A"),
    ("rs4149056", "chr12", "21178615", "T", "C"),
    ("rs3918290", "chr1", "97450058", "C", "T"),
    ("rs1142345", "chr6", "18130687", "T", "C"),
    ("rs9923231", "chr16", "31096368", "C", "T"),
];

fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn site(rsid: &str) -> (&'static str, &'static str, &'static str, &'static str) {
    let &(_, chrom, pos, reference, alt) = GRCH38
        .iter()
        .find(|row| row.0 == rsid)
        .unwrap_or_else(|| panic!("{rsid} is not in the GRCh38 table"));
    (chrom, pos, reference, alt)
}

fn check_genotype(rsid: &str, genotype: &str, reference: &str, alt: &str) {
    for allele in genotype.split(['/', '|']) {
        assert!(
            allele == reference || allele == alt,
            "{rsid} genotype {genotype} has {allele}, not {reference} or {alt}"
        );
    }
}

#[test]
fn panel_is_the_grch38_table_in_order() {
    let panel: Vec<&str> = PANEL.iter().map(|entry| entry.rsid).collect();
    let table: Vec<&str> = GRCH38.iter().map(|row| row.0).collect();
    assert_eq!(panel, table);
}

#[test]
fn fixture_leaves_are_forward_strand_grch38() {
    for set in ["present", "unanswered", "eio"] {
        for entry in PANEL {
            let (chrom, pos, reference, alt) = site(entry.rsid);
            let base = crate_root()
                .join("fixtures")
                .join(set)
                .join(rsid_genotypes::grant_path(entry.rsid));
            let leaf = |name: &str| fs::read_to_string(base.join(name)).ok();
            let at = format!("{set}/{}", entry.rsid);
            assert_eq!(
                leaf("chromosome").as_deref(),
                Some(chrom),
                "{at} chromosome"
            );
            assert_eq!(leaf("position").as_deref(), Some(pos), "{at} position");
            assert_eq!(
                leaf("reference").as_deref(),
                Some(reference),
                "{at} reference"
            );
            if base.join("genotype").is_file() {
                let genotype = leaf("genotype").unwrap();
                check_genotype(entry.rsid, &genotype, reference, alt);
            }
        }
    }
}

#[test]
fn golden_rows_are_forward_strand_grch38() {
    for golden in ["present.tsv", "unanswered.tsv"] {
        let text = fs::read_to_string(crate_root().join("goldens").join(golden)).unwrap();
        let rows: Vec<Vec<&str>> = text
            .lines()
            .filter(|line| line.starts_with("rs"))
            .map(|line| line.split('\t').collect())
            .collect();
        assert_eq!(rows.len(), GRCH38.len(), "{golden} row count");
        for (row, &(rsid, chrom, pos, reference, alt)) in rows.iter().zip(GRCH38) {
            assert_eq!(row[..4], [rsid, chrom, pos, reference], "{golden} {rsid}");
            if row[4] != rsid_genotypes::NO_CALL {
                check_genotype(rsid, row[4], reference, alt);
            }
        }
    }
}

fn catalog_panel(path: &Path) -> Vec<[String; 5]> {
    let text = fs::read_to_string(path).unwrap();
    let mut lines = text.lines().filter(|line| !line.starts_with('#'));
    let header: Vec<&str> = lines.next().unwrap().split('\t').collect();
    let column = |name: &str| {
        header
            .iter()
            .position(|field| *field == name)
            .unwrap_or_else(|| panic!("catalog has no {name} column"))
    };
    let picks = ["rsid", "chrom", "pos", "ref", "alt"].map(column);
    let category = column("category");
    lines
        .map(|line| line.split('\t').collect::<Vec<&str>>())
        .filter(|fields| fields[category] == "panel")
        .map(|fields| picks.map(|index| fields[index].to_string()))
        .collect()
}

#[test]
fn table_matches_the_genome_synth_catalog_when_present() {
    let catalog = crate_root().join("../../../scripts/genome-synth/variants.tsv");
    if !catalog.is_file() {
        eprintln!(
            "skip catalog check: {} not in this checkout",
            catalog.display()
        );
        return;
    }
    let want: Vec<[String; 5]> = GRCH38
        .iter()
        .map(|&(a, b, c, d, e)| [a, b, c, d, e].map(String::from))
        .collect();
    assert_eq!(catalog_panel(&catalog), want);
}
