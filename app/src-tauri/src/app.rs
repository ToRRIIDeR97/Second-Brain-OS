use crate::commands;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppRuntime::load())
        .invoke_handler(tauri::generate_handler![
            commands::system_ping,
            commands::system_sample_error,
            commands::shell_load_layout,
            commands::shell_save_layout,
            commands::job_cancel,
            commands::workspace_register,
            commands::workspace_list,
            commands::workspace_list_directory,
            commands::file_read_text,
            commands::file_create_attachment,
            commands::file_read_attachment,
            commands::file_write_text,
            commands::git_status,
            commands::git_diff,
            commands::git_stage,
            commands::git_unstage,
            commands::git_discard,
            commands::workspace_search,
            commands::workspace_graph,
            commands::terminal_start,
            commands::terminal_sessions,
            commands::terminal_write,
            commands::terminal_read,
            commands::terminal_resize,
            commands::terminal_terminate
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Second Brain OS");
}
