// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // AI clients launch `noesis --mcp` and talk JSON-RPC over stdio; no window is created.
    if std::env::args().any(|a| a == "--mcp") {
        return noesis_lib::run_mcp_bridge();
    }
    noesis_lib::run()
}
