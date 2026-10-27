//! Closed rsID panel. Reads `v1/genome/rsids/<rsid>/{chromosome,position,reference,genotype}`,
//! which ArkOS 0.13 still serves (it adds `end`, `changes/` and `copies/`,
//! which this app does not read). Each site is an optional grant: the owner
//! switches it on at approval, and a declined site and one the Ark has no data
//! for both stay unmounted, so the app cannot tell them apart and prints
//! `not granted` for either.
//!
//! Panel SNPs are star-allele defining sites from public CPIC / PharmGKB allele
//! definition tables (https://cpicpgx.org/guidelines/ and
//! https://www.pharmgkb.org/page/cyp2c19RefMaterials — checked 2026-09-28).
//! Gene symbols here are documentation only and are not printed.

use std::fs;
use std::io;
use std::path::Path;

pub const APP_NAME: &str = "rsid-genotypes";
pub const APP_VERSION: &str = "0.2.0";
pub const TITLE: &str = "# rsID genotypes";
pub const FOOTER: &str =
    "Research use only; genotypes as recorded in the loaded call file.";
pub const NO_CALL: &str = "no call";
pub const NOT_GRANTED: &str = "not granted";
/// Public grant (never shown to the owner) that makes the Ark refuse the run
/// until small variants are loaded, so an empty Ark is not eleven `not granted`.
pub const REQUIRED_DATASET: &str = "v1/genome/datasets/small-variants";

#[derive(Clone, Copy)]
pub struct PanelEntry {
    pub rsid: &'static str,
    /// Documentation / citation only — not printed on the report line.
    pub gene: &'static str,
}

/// Order is the report order. Do not readdir `rsids/`.
pub const PANEL: &[PanelEntry] = &[
    PanelEntry {
        rsid: "rs4244285",
        gene: "CYP2C19",
    }, // *2
    PanelEntry {
        rsid: "rs4986893",
        gene: "CYP2C19",
    }, // *3
    PanelEntry {
        rsid: "rs12248560",
        gene: "CYP2C19",
    }, // *17
    PanelEntry {
        rsid: "rs1799853",
        gene: "CYP2C9",
    }, // *2
    PanelEntry {
        rsid: "rs1057910",
        gene: "CYP2C9",
    }, // *3
    PanelEntry {
        rsid: "rs3892097",
        gene: "CYP2D6",
    }, // *4
    PanelEntry {
        rsid: "rs1065852",
        gene: "CYP2D6",
    }, // *10
    PanelEntry {
        rsid: "rs4149056",
        gene: "SLCO1B1",
    }, // *5
    PanelEntry {
        rsid: "rs3918290",
        gene: "DPYD",
    }, // *2A
    PanelEntry {
        rsid: "rs1142345",
        gene: "TPMT",
    }, // *3C
    PanelEntry {
        rsid: "rs9923231",
        gene: "VKORC1",
    }, // c.-1639G>A
];

pub fn grant_path(rsid: &str) -> String {
    format!("v1/genome/rsids/{rsid}")
}

/// The manifest the Ark reads in its manifest pass: TOML, `manifest = 1`
/// (Ark CLI 0.5.0 / ArkOS 0.13). Panel sites are optional grants in report order.
pub fn manifest_toml() -> String {
    let mut out = String::from("manifest = 1\n\n[app]\n");
    out.push_str(&format!("name = \"{APP_NAME}\"\n"));
    out.push_str(&format!("version = \"{APP_VERSION}\"\n\n"));
    out.push_str("[reads]\n");
    out.push_str(&format!("paths = [\"{REQUIRED_DATASET}\"]\n"));
    out.push_str("optional = [\n");
    for entry in PANEL {
        out.push_str(&format!("  \"{}\",\n", grant_path(entry.rsid)));
    }
    out.push_str("]\n\n[output]\nreport = \"text/markdown\"\n");
    out
}

enum Leaf {
    Value(String),
    Missing,
}

fn read_leaf(base: &Path, rsid: &str, name: &str) -> Result<Leaf, String> {
    match fs::read_to_string(base.join(name)) {
        Ok(value) => Ok(Leaf::Value(value)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(Leaf::Missing),
        Err(err) => Err(format!("could not read {rsid} {name}: {err}")),
    }
}

fn field(leaf: Leaf) -> String {
    match leaf {
        Leaf::Value(value) => value,
        Leaf::Missing => String::new(),
    }
}

pub fn format_line(
    rsid: &str,
    chromosome: &str,
    position: &str,
    reference: &str,
    genotype: Option<&str>,
) -> String {
    let call = genotype.unwrap_or(NO_CALL);
    format!("{rsid}\t{chromosome}\t{position}\t{reference}\t{call}")
}

/// Whether the Ark mounted this site. Absent or not permitted means an
/// optional grant left off or a site the Ark has no data for.
fn is_mounted(base: &Path, rsid: &str) -> Result<bool, String> {
    match fs::metadata(base) {
        Ok(meta) if meta.is_dir() => Ok(true),
        Ok(_) => Err(format!("could not read {rsid}: not a directory")),
        Err(err)
            if matches!(
                err.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied
            ) =>
        {
            Ok(false)
        }
        Err(err) => Err(format!("could not read {rsid}: {err}")),
    }
}

pub fn report_for_root(root: &Path) -> Result<String, String> {
    let mut lines: Vec<String> = vec![TITLE.to_string(), String::new()];
    for entry in PANEL {
        let base = root.join(grant_path(entry.rsid));
        if !is_mounted(&base, entry.rsid)? {
            lines.push(format!("{}\t\t\t\t{NOT_GRANTED}", entry.rsid));
            continue;
        }
        let chromosome = field(read_leaf(&base, entry.rsid, "chromosome")?);
        let position = field(read_leaf(&base, entry.rsid, "position")?);
        let reference = field(read_leaf(&base, entry.rsid, "reference")?);
        let genotype = match read_leaf(&base, entry.rsid, "genotype")? {
            Leaf::Value(value) => Some(value),
            Leaf::Missing => None,
        };
        lines.push(format_line(
            entry.rsid,
            &chromosome,
            &position,
            &reference,
            genotype.as_deref(),
        ));
    }
    lines.push(String::new());
    lines.push(FOOTER.to_string());
    let mut report = lines.join("\n");
    report.push('\n');
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn crate_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    #[test]
    fn format_line_present_and_no_call() {
        assert_eq!(
            format_line("rs4244285", "chr10", "94781859", "G", Some("A/G")),
            "rs4244285\tchr10\t94781859\tG\tA/G"
        );
        assert_eq!(
            format_line("rs4244285", "chr10", "94781859", "G", None),
            "rs4244285\tchr10\t94781859\tG\tno call"
        );
    }

    #[test]
    fn present_fixture_matches_golden() {
        let got = report_for_root(&crate_root().join("fixtures/present")).unwrap();
        let want = fs::read_to_string(crate_root().join("goldens/present.tsv")).unwrap();
        assert_eq!(got, want);
    }

    #[test]
    fn unanswered_fixture_matches_golden() {
        let got = report_for_root(&crate_root().join("fixtures/unanswered")).unwrap();
        let want = fs::read_to_string(crate_root().join("goldens/unanswered.tsv")).unwrap();
        assert_eq!(got, want);
    }

    #[test]
    fn declined_fixture_matches_golden() {
        let got = report_for_root(&crate_root().join("fixtures/declined")).unwrap();
        let want = fs::read_to_string(crate_root().join("goldens/declined.tsv")).unwrap();
        assert_eq!(got, want);
    }

    #[test]
    fn unmounted_root_reads_every_site_as_not_granted() {
        let got = report_for_root(&crate_root().join("fixtures/none-mounted")).unwrap();
        let rows: Vec<String> = got
            .lines()
            .filter(|line| line.starts_with("rs"))
            .map(String::from)
            .collect();
        let want: Vec<String> = PANEL
            .iter()
            .map(|entry| format!("{}\t\t\t\tnot granted", entry.rsid))
            .collect();
        assert_eq!(rows, want);
    }

    #[test]
    fn eio_genotype_directory_fails_without_footer() {
        let err = report_for_root(&crate_root().join("fixtures/eio")).unwrap_err();
        assert!(err.contains("rs4244285"));
        assert!(err.contains("genotype"));
        assert!(!err.contains(FOOTER));
    }

    #[test]
    fn panel_is_eleven_documented_sites() {
        assert_eq!(PANEL.len(), 11);
        assert!(PANEL.iter().all(|entry| !entry.gene.is_empty()));
    }

    #[test]
    fn manifest_is_v1_toml_with_optional_panel_grants() {
        let mut want = String::from(
            "manifest = 1\n\n[app]\nname = \"rsid-genotypes\"\nversion = \"0.2.0\"\n\n\
             [reads]\npaths = [\"v1/genome/datasets/small-variants\"]\noptional = [\n",
        );
        for entry in PANEL {
            want.push_str(&format!("  \"v1/genome/rsids/{}\",\n", entry.rsid));
        }
        want.push_str("]\n\n[output]\nreport = \"text/markdown\"\n");
        let toml = manifest_toml();
        assert_eq!(toml, want);
        assert!(!toml.contains("develop"));
        assert!(toml.len() < 64 * 1024);
    }
}
