use crate::db::Database;
use crate::errors::{AppError, AppResult};
use crate::platform::{Clock, SystemClock, ensure_application_data_dir};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

const IPC_CONTRACT: &str = "ipc_result";
const IPC_VERSION: u32 = 1;
const SHELL_LAYOUT_KEY: &str = "shell.layout";

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum CommandResult<T> {
    Success(CommandSuccess<T>),
    Failure(CommandFailure),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuccess<T> {
    contract: &'static str,
    version: u32,
    ok: bool,
    data: T,
    correlation_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandFailure {
    contract: &'static str,
    version: u32,
    ok: bool,
    error: AppError,
    correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellLayout {
    pub version: u32,
    pub sidebar_width: u32,
    pub inspector_width: u32,
    pub inspector_open: bool,
    pub drawer_open: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobCancellation {
    job_id: String,
    cancelled: bool,
}

impl<T> CommandResult<T> {
    fn from_result(result: AppResult<T>, correlation_id: String) -> Self {
        match result {
            Ok(data) => Self::Success(CommandSuccess {
                contract: IPC_CONTRACT,
                version: IPC_VERSION,
                ok: true,
                data,
                correlation_id,
            }),
            Err(error) => Self::Failure(CommandFailure {
                contract: IPC_CONTRACT,
                version: IPC_VERSION,
                ok: false,
                error: error.redacted(),
                correlation_id,
            }),
        }
    }
}

fn correlation_id() -> String {
    format!("corr_{}", ulid::Ulid::new())
}

fn database() -> AppResult<Database> {
    Database::open(ensure_application_data_dir()?.database)
}

fn load_layout(database: &Database) -> AppResult<Option<ShellLayout>> {
    let value = database.with_connection(|connection| {
        connection
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                [SHELL_LAYOUT_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()
    })?;
    value
        .map(|value| {
            serde_json::from_str(&value).map_err(|error| {
                AppError::new(
                    "settings.invalid",
                    "The saved shell layout could not be read.",
                )
                .with_details(serde_json::Value::String(error.to_string()))
            })
        })
        .transpose()
}

fn save_layout(database: &Database, layout: &ShellLayout) -> AppResult<()> {
    let value = serde_json::to_string(layout).map_err(|error| {
        AppError::new("settings.serialize", "The shell layout could not be saved.")
            .with_details(serde_json::Value::String(error.to_string()))
    })?;
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO app_settings (key, value_json, schema_version, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(key) DO UPDATE SET
               value_json = excluded.value_json,
               schema_version = excluded.schema_version,
               updated_at = excluded.updated_at",
            params![
                SHELL_LAYOUT_KEY,
                value,
                layout.version,
                SystemClock.now_utc()
            ],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn system_ping() -> CommandResult<&'static str> {
    CommandResult::from_result(Ok("pong"), correlation_id())
}

#[tauri::command]
pub fn system_sample_error() -> CommandResult<()> {
    CommandResult::from_result(
        Err(AppError::new(
            "system.sample_error",
            "This typed sample error is working as expected.",
        )),
        correlation_id(),
    )
}

#[tauri::command]
pub fn shell_load_layout() -> CommandResult<Option<ShellLayout>> {
    let result = database().and_then(|database| load_layout(&database));
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn shell_save_layout(layout: ShellLayout) -> CommandResult<ShellLayout> {
    let result = database().and_then(|database| {
        save_layout(&database, &layout)?;
        Ok(layout)
    });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn job_cancel(job_id: String) -> CommandResult<JobCancellation> {
    CommandResult::from_result(
        Ok(JobCancellation {
            job_id,
            cancelled: false,
        }),
        correlation_id(),
    )
}

#[cfg(test)]
mod tests {
    use super::{ShellLayout, load_layout, save_layout, system_sample_error};
    use crate::db::Database;

    #[test]
    fn shell_layout_round_trips_through_settings() {
        let database = Database::open(":memory:").expect("database");
        let layout = ShellLayout {
            version: 1,
            sidebar_width: 24,
            inspector_width: 20,
            inspector_open: true,
            drawer_open: false,
        };
        save_layout(&database, &layout).expect("save");
        let restored = load_layout(&database).expect("load").expect("layout");
        assert_eq!(restored.sidebar_width, 24);
        assert!(restored.inspector_open);
    }

    #[test]
    fn sample_error_uses_the_versioned_ipc_envelope() {
        let value = serde_json::to_value(system_sample_error()).expect("serialize");
        assert_eq!(value["contract"], "ipc_result");
        assert_eq!(value["version"], 1);
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "system.sample_error");
    }
}
