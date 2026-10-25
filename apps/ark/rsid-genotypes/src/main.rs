use std::env;
use std::path::Path;
use std::process;

fn main() {
    let Some(dir) = env::args().nth(1) else {
        print!("{}", rsid_genotypes::manifest_toml());
        return;
    };
    match rsid_genotypes::report_for_root(Path::new(&dir)) {
        Ok(report) => print!("{report}"),
        Err(message) => {
            eprintln!("{message}");
            process::exit(1);
        }
    }
}
