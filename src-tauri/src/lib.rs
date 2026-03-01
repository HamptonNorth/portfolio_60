use std::env;
use std::path::PathBuf;
use std::process::{Command, Child};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

/// Holds the Bun server child process so we can kill it on app exit.
/// In dev mode this is None (the server is started by beforeDevCommand).
/// In production mode this holds the spawned child process.
struct ServerProcess(Option<Child>);

impl Drop for ServerProcess {
    fn drop(&mut self) {
        if let Some(ref mut child) = self.0 {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Find the bun binary. When launched from a desktop shortcut the user's
/// shell PATH may not be available, so we check common install locations.
/// Returns the full path to the bun binary, or "bun" as a fallback to
/// let the OS search PATH.
fn find_bun() -> String {
    // Check BUN_INSTALL or common locations
    let home = env::var("HOME").unwrap_or_else(|_| "/home/rcollins".to_string());

    let candidates = vec![
        // BUN_INSTALL env var (standard Bun installer sets this)
        env::var("BUN_INSTALL")
            .map(|dir| format!("{}/bin/bun", dir))
            .unwrap_or_default(),
        // Default Bun install location
        format!("{}/.bun/bin/bun", home),
        // System-wide install
        "/usr/local/bin/bun".to_string(),
        "/usr/bin/bun".to_string(),
    ];

    for candidate in candidates {
        if !candidate.is_empty() && PathBuf::from(&candidate).exists() {
            return candidate;
        }
    }

    // Fallback: hope it's on PATH
    "bun".to_string()
}

/// Wait for the Bun server to be ready by polling the TCP port.
/// Returns true if the server responded within the timeout, false otherwise.
fn wait_for_server(port: u16, timeout_secs: u64) -> bool {
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(timeout_secs);

    while start.elapsed() < timeout {
        if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(200));
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // In dev mode (tauri dev), the beforeDevCommand in tauri.conf.json
    // already starts the Bun server via "bun run dev". We must not spawn
    // a second server or we get a port conflict.
    //
    // In production (tauri build / installed .deb), no server is running,
    // so we spawn the Bun server ourselves as a child process.
    //
    // We detect if a server is already running by checking if port 1420 is in use.
    // This works for both debug and release builds.
    let server_already_running = std::net::TcpStream::connect("127.0.0.1:1420").is_ok();

    let server_child = if server_already_running {
        // Server already running (e.g. via beforeDevCommand in tauri dev)
        None
    } else {
        // Detect Flatpak environment
        let is_flatpak = env::var("FLATPAK_ID").is_ok();

        let (project_dir, bun_path, data_dir) = if is_flatpak {
            // Flatpak mode: app source bundled at /app/share/portfolio_60,
            // bun at /app/bin/bun, writable data at ~/.config/portfolio_60
            let home = env::var("HOME").unwrap_or_else(|_| "/home/rcollins".to_string());
            let data = format!("{}/.config/portfolio_60", home);

            // Ensure writable data directory exists
            let _ = std::fs::create_dir_all(&data);

            // Copy bundled config.json to data dir on first run
            let data_config = format!("{}/config.json", data);
            if !std::path::Path::new(&data_config).exists() {
                let bundled_config = "/app/share/portfolio_60/src/shared/config.json";
                if std::path::Path::new(bundled_config).exists() {
                    let _ = std::fs::copy(bundled_config, &data_config);
                }
            }

            (
                "/app/share/portfolio_60".to_string(),
                "/app/bin/bun".to_string(),
                Some(data),
            )
        } else {
            // Normal mode: use PORTFOLIO60_DIR or default to ~/code/portfolio_60
            let home = env::var("HOME").unwrap_or_else(|_| "/home/rcollins".to_string());
            let project = env::var("PORTFOLIO60_DIR").unwrap_or_else(|_| {
                format!("{}/code/portfolio_60", home)
            });
            let bun = find_bun();

            // Use the same data directory as Flatpak mode for consistency
            let data = format!("{}/.config/portfolio_60", home);
            let _ = std::fs::create_dir_all(&data);

            (project, bun, Some(data))
        };

        let mut cmd = Command::new(&bun_path);
        cmd.arg("run")
            .arg("src/server/index.js")
            .current_dir(&project_dir);

        // In Flatpak mode, set PORTFOLIO60_DATA_DIR so the server writes
        // database, backups, docs, .env, and config to a writable location
        if let Some(ref data) = data_dir {
            cmd.env("PORTFOLIO60_DATA_DIR", data);
        }

        let child = cmd.spawn().unwrap_or_else(|e| {
            panic!(
                "Failed to start Bun server.\n  Bun path: {}\n  Project dir: {}\n  Error: {}",
                bun_path, project_dir, e
            )
        });

        // Wait for the server to be ready before opening the window
        if !wait_for_server(1420, 15) {
            eprintln!("Warning: Bun server did not start within 15 seconds");
        }

        Some(child)
    };

    let server = Mutex::new(ServerProcess(server_child));

    tauri::Builder::default()
        .manage(server)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_window_event(|_window, _event| {
            // The server process is cleaned up automatically via Drop
            // when the Tauri app state is dropped on exit.
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
