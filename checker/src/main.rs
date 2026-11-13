//! WASI entry point: JSON input on stdin, JSON verdict on stdout.
use std::io::{Read, Write};

fn main() {
    let mut raw = Vec::new();
    // A read error leaves `raw` partial/empty, which fails closed as malformed_input.
    let _ = std::io::stdin().read_to_end(&mut raw);
    let out = nixo_checker::shell::run(&raw);
    let json = serde_json::to_string(&out).expect("output is always serializable");
    let mut stdout = std::io::stdout();
    let _ = stdout.write_all(json.as_bytes());
    let _ = stdout.flush();
}
