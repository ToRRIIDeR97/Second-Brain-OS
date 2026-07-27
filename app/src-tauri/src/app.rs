use crate::commands;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::system_ping,
            commands::system_sample_error,
            commands::shell_load_layout,
            commands::shell_save_layout,
            commands::job_cancel
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Second Brain OS");
}
