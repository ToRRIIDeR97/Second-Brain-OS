use crate::commands;
use crate::platform::{application_data_dir, logging::init_logging};

pub fn run() {
    let _logging = match application_data_dir().and_then(|path| init_logging(&path)) {
        Ok(guard) => Some(guard),
        Err(error) => {
            eprintln!("Second Brain OS logging unavailable: {error}");
            None
        }
    };

    tracing::info!(lifecycle = "starting", "Second Brain OS starting");

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppRuntime::load())
        .invoke_handler(tauri::generate_handler![
            commands::system_log,
            commands::system_ping,
            commands::system_sample_error,
            commands::shell_load_layout,
            commands::shell_save_layout,
            commands::integration_settings_get,
            commands::integration_settings_save,
            commands::google_connection_status_get,
            commands::google_connect,
            commands::google_sync,
            commands::google_disconnect,
            commands::job_cancel,
            commands::workspace_select_root,
            commands::workspace_register,
            commands::workspace_list,
            commands::workspace_list_directory,
            commands::project_list,
            commands::project_get,
            commands::project_create,
            commands::project_update,
            commands::project_set_status,
            commands::activity_list,
            commands::planner_list,
            commands::planner_create,
            commands::planner_update,
            commands::planner_delete,
            commands::agent_provider_probe,
            commands::agent_session_start,
            commands::agent_session_list,
            commands::agent_session_message,
            commands::agent_session_cancel,
            commands::agent_approval_decide,
            commands::file_read_text,
            commands::file_create_attachment,
            commands::file_read_attachment,
            commands::file_write_text,
            commands::git_status,
            commands::git_diff,
            commands::git_file_diff,
            commands::git_stage,
            commands::git_unstage,
            commands::git_discard,
            commands::language_tools_status,
            commands::language_format,
            commands::language_analyze,
            commands::lsp_start,
            commands::lsp_send,
            commands::lsp_receive,
            commands::lsp_stop,
            commands::workspace_search,
            commands::workspace_graph,
            commands::terminal_start,
            commands::terminal_sessions,
            commands::terminal_write,
            commands::terminal_read,
            commands::terminal_resize,
            commands::terminal_terminate
        ])
        .run(tauri::generate_context!());

    match result {
        Ok(()) => tracing::info!(lifecycle = "stopped", "Second Brain OS stopped"),
        Err(error) => {
            tracing::error!(error = %error, lifecycle = "failed", "Second Brain OS failed");
            panic!("failed to run Second Brain OS: {error}");
        }
    }
}
