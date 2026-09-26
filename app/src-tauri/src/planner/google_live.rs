//! Production Google OAuth, credential, and HTTP adapters.

use crate::errors::{AppError, AppResult};
use crate::planner::google::{
    CalendarEvent, GoogleProvider, GoogleTask, ProviderError, SyncPage, TaskListEntry,
};
use crate::platform::Clock;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use keyring::{Entry, Error as KeyringError};
use reqwest::StatusCode;
use reqwest::blocking::{Client, Response};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};
use url::Url;

pub const GOOGLE_ACCOUNT_ID: &str = "google_primary";
pub const GOOGLE_CREDENTIAL_KEY: &str = "second-brain-os/google/primary";
const CREDENTIAL_SERVICE: &str = "com.secondbrain.os.google";
const CREDENTIAL_USER: &str = "primary";
const CLIENT_SECRET_CREDENTIAL_USER_PREFIX: &str = "client-secret:";
const AUTHORIZATION_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
const CALENDAR_EVENTS_ENDPOINT: &str =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TASK_LISTS_ENDPOINT: &str = "https://tasks.googleapis.com/tasks/v1/users/@me/lists";
const TASKS_ENDPOINT_PREFIX: &str = "https://tasks.googleapis.com/tasks/v1/lists/";
const OAUTH_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const CALLBACK_LIMIT_BYTES: usize = 8 * 1024;

const CALENDAR_READ_SCOPE: &str = "https://www.googleapis.com/auth/calendar.readonly";
const CALENDAR_WRITE_SCOPE: &str = "https://www.googleapis.com/auth/calendar.events";
const TASKS_READ_SCOPE: &str = "https://www.googleapis.com/auth/tasks.readonly";
const TASKS_WRITE_SCOPE: &str = "https://www.googleapis.com/auth/tasks";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GoogleAccess {
    pub read_write: bool,
    pub calendar_enabled: bool,
    pub tasks_enabled: bool,
}

pub struct GoogleAuthorization {
    pub refresh_token: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    scope: Option<String>,
}

#[derive(Deserialize)]
struct TokenErrorResponse {
    error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarEventsResponse {
    #[serde(default)]
    items: Vec<CalendarEventResponse>,
    next_page_token: Option<String>,
    next_sync_token: Option<String>,
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CalendarEventResponse {
    id: String,
    #[serde(default)]
    summary: String,
    description: Option<String>,
    location: Option<String>,
    #[serde(default)]
    status: String,
    #[serde(default)]
    start: CalendarDateTime,
    #[serde(default)]
    end: CalendarDateTime,
    recurring_event_id: Option<String>,
    etag: Option<String>,
    #[serde(default)]
    updated: String,
}

#[derive(Debug, Default, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CalendarDateTime {
    date: Option<String>,
    date_time: Option<String>,
    time_zone: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskListsResponse {
    #[serde(default)]
    items: Vec<TaskListResponse>,
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize, serde::Serialize)]
struct TaskListResponse {
    id: String,
    #[serde(default)]
    title: String,
    etag: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TasksResponse {
    #[serde(default)]
    items: Vec<TaskResponse>,
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize, serde::Serialize)]
struct TaskResponse {
    id: String,
    #[serde(default)]
    title: String,
    notes: Option<String>,
    due: Option<String>,
    #[serde(default)]
    status: String,
    #[serde(default)]
    deleted: bool,
    etag: Option<String>,
    #[serde(default)]
    updated: String,
}

pub fn scopes(access: GoogleAccess) -> Vec<&'static str> {
    let mut scopes = Vec::new();
    if access.calendar_enabled {
        scopes.push(CALENDAR_READ_SCOPE);
        if access.read_write {
            scopes.push(CALENDAR_WRITE_SCOPE);
        }
    }
    if access.tasks_enabled {
        scopes.push(if access.read_write {
            TASKS_WRITE_SCOPE
        } else {
            TASKS_READ_SCOPE
        });
    }
    scopes
}

fn credential_entry() -> AppResult<Entry> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER).map_err(|_| {
        AppError::new(
            "google.credential_store_unavailable",
            "Windows Credential Manager is unavailable.",
        )
    })
}

fn client_secret_entry(client_id: &str) -> AppResult<Entry> {
    Entry::new(
        CREDENTIAL_SERVICE,
        &format!("{CLIENT_SECRET_CREDENTIAL_USER_PREFIX}{client_id}"),
    )
    .map_err(|_| {
        AppError::new(
            "google.credential_store_unavailable",
            "Windows Credential Manager is unavailable.",
        )
    })
}

pub fn store_client_secret(client_id: &str, client_secret: &str) -> AppResult<()> {
    if client_secret.trim().is_empty() {
        return Err(AppError::new(
            "google.client_secret_required",
            "Enter the client secret from the Google Desktop OAuth JSON.",
        ));
    }
    client_secret_entry(client_id)?
        .set_password(client_secret)
        .map_err(|_| {
            AppError::new(
                "google.credential_store_failed",
                "The Google OAuth client secret could not be secured in Windows Credential Manager.",
            )
        })
}

pub fn load_client_secret(client_id: &str) -> AppResult<Option<String>> {
    match client_secret_entry(client_id)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(_) => Err(AppError::new(
            "google.credential_read_failed",
            "The saved Google OAuth client secret could not be read from Windows Credential Manager.",
        )),
    }
}

pub fn store_refresh_token(refresh_token: &str) -> AppResult<()> {
    if refresh_token.trim().is_empty() {
        return Err(AppError::new(
            "google.refresh_token_missing",
            "Google did not return a reusable sign-in token. Try connecting again.",
        ));
    }
    credential_entry()?
        .set_password(refresh_token)
        .map_err(|_| {
            AppError::new(
                "google.credential_store_failed",
                "The Google connection could not be secured in Windows Credential Manager.",
            )
        })
}

pub fn load_refresh_token() -> AppResult<Option<String>> {
    match credential_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(_) => Err(AppError::new(
            "google.credential_read_failed",
            "The saved Google connection could not be read from Windows Credential Manager.",
        )),
    }
}

pub fn delete_refresh_token() -> AppResult<()> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(_) => Err(AppError::new(
            "google.credential_delete_failed",
            "The Google connection could not be removed from Windows Credential Manager.",
        )),
    }
}

fn http_client() -> AppResult<Client> {
    Client::builder()
        .timeout(HTTP_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| {
            AppError::new(
                "google.http_unavailable",
                "Google could not be reached from this installation.",
            )
            .retryable(true)
        })
}

fn random_material() -> String {
    format!("{}{}", ulid::Ulid::new(), ulid::Ulid::new())
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn authorization_url(
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    verifier: &str,
    access: GoogleAccess,
) -> AppResult<Url> {
    let requested_scopes = scopes(access);
    if requested_scopes.is_empty() {
        return Err(AppError::new(
            "google.service_required",
            "Turn on Google Calendar or Google Tasks before connecting.",
        ));
    }
    let mut url = Url::parse(AUTHORIZATION_ENDPOINT).map_err(|_| {
        AppError::new(
            "google.oauth_unavailable",
            "The Google authorization endpoint is invalid.",
        )
    })?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", &requested_scopes.join(" "))
        .append_pair("state", state)
        .append_pair("code_challenge", &pkce_challenge(verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    Ok(url)
}

fn wait_for_callback(listener: &TcpListener, expected_state: &str) -> AppResult<String> {
    listener.set_nonblocking(true)?;
    let deadline = Instant::now() + OAUTH_TIMEOUT;
    loop {
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !matches!(peer.ip(), IpAddr::V4(address) if address.is_loopback()) {
                    continue;
                }
                return read_callback(&mut stream, expected_state);
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock && Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                return Err(AppError::new(
                    "google.oauth_timed_out",
                    "Google sign-in timed out. Start the connection again.",
                ));
            }
            Err(_) => {
                return Err(AppError::new(
                    "google.oauth_callback_failed",
                    "The local Google sign-in callback could not be received.",
                ));
            }
        }
    }
}

fn read_callback(stream: &mut TcpStream, expected_state: &str) -> AppResult<String> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut request = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];
    while request.len() < CALLBACK_LIMIT_BYTES {
        let count = stream.read(&mut chunk).map_err(|_| {
            AppError::new(
                "google.oauth_callback_invalid",
                "The Google sign-in callback could not be read.",
            )
        })?;
        if count == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..count]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let first_line = std::str::from_utf8(&request)
        .ok()
        .and_then(|request| request.lines().next())
        .ok_or_else(|| {
            AppError::new(
                "google.oauth_callback_invalid",
                "The Google sign-in callback was invalid.",
            )
        })?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    if method != "GET" || parts.next().is_none() || target.len() > 4096 {
        write_callback_response(stream, false);
        return Err(AppError::new(
            "google.oauth_callback_invalid",
            "The Google sign-in callback was invalid.",
        ));
    }
    let callback = Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| {
        AppError::new(
            "google.oauth_callback_invalid",
            "The Google sign-in callback was invalid.",
        )
    })?;
    if callback.path() != "/" {
        write_callback_response(stream, false);
        return Err(AppError::new(
            "google.oauth_callback_invalid",
            "The Google sign-in callback used an unexpected path.",
        ));
    }
    let values = callback
        .query_pairs()
        .collect::<std::collections::BTreeMap<_, _>>();
    if values.get("state").map(|value| value.as_ref()) != Some(expected_state) {
        write_callback_response(stream, false);
        return Err(AppError::new(
            "google.oauth_state_mismatch",
            "Google sign-in could not be verified. Start the connection again.",
        ));
    }
    if let Some(error) = values.get("error") {
        write_callback_response(stream, false);
        return Err(AppError::new(
            "google.oauth_denied",
            if error == "access_denied" {
                "Google sign-in was cancelled."
            } else {
                "Google did not authorize this connection."
            },
        ));
    }
    let code = values
        .get("code")
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| {
            AppError::new(
                "google.oauth_code_missing",
                "Google did not return an authorization code.",
            )
        })?;
    write_callback_response(stream, true);
    Ok(code)
}

fn write_callback_response(stream: &mut TcpStream, accepted: bool) {
    let (title, message) = if accepted {
        (
            "Authorization received",
            "Return to Second Brain OS while it finishes the connection.",
        )
    } else {
        (
            "Authorization not accepted",
            "Return to Second Brain OS and start the connection again.",
        )
    };
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>{title}</title><style>body{{font:16px system-ui;max-width:38rem;margin:15vh auto;padding:2rem;color:#172033}}h1{{font-size:1.5rem}}</style><h1>{title}</h1><p>{message}</p>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn parse_token_response(response: Response, action: &str) -> AppResult<TokenResponse> {
    if !response.status().is_success() {
        let error = response
            .json::<TokenErrorResponse>()
            .ok()
            .map(|response| response.error);
        return Err(token_exchange_error(action, error.as_deref()));
    }
    response.json::<TokenResponse>().map_err(|_| {
        AppError::new(
            "google.oauth_response_invalid",
            "Google returned an unreadable authorization response.",
        )
    })
}

fn token_exchange_error(action: &str, error: Option<&str>) -> AppError {
    match error {
        Some("invalid_client" | "unauthorized_client" | "redirect_uri_mismatch") => AppError::new(
            "google.oauth_client_rejected",
            "Google rejected this OAuth client. Create a Google OAuth client with application type Desktop app, then save its client ID.",
        ),
        Some("invalid_grant") if action == "connection refresh" => AppError::new(
            "google.reconnect_required",
            "The Google connection expired or was revoked. Connect it again in Settings.",
        ),
        Some("invalid_grant") => AppError::new(
            "google.oauth_code_rejected",
            "Google rejected the authorization code. Start Connect Google again. If it repeats, replace the OAuth client with a Desktop app client.",
        ),
        Some("invalid_request") => AppError::new(
            "google.oauth_request_rejected",
            "Google rejected the authorization request. Check that the client ID and client secret come from the same Desktop OAuth JSON.",
        ),
        _ => AppError::new(
            "google.oauth_exchange_failed",
            format!("Google {action} failed. Try connecting again."),
        ),
    }
}

pub fn authorize(
    client_id: &str,
    client_secret: &str,
    access: GoogleAccess,
) -> AppResult<GoogleAuthorization> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| {
        AppError::new(
            "google.oauth_port_unavailable",
            "A local callback port could not be opened for Google sign-in.",
        )
    })?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let state = random_material();
    let verifier = random_material();
    let url = authorization_url(client_id, &redirect_uri, &state, &verifier, access)?;
    open::that(url.as_str()).map_err(|_| {
        AppError::new(
            "google.browser_unavailable",
            "The default browser could not be opened for Google sign-in.",
        )
    })?;
    let code = wait_for_callback(&listener, &state)?;
    let form = [
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code", code.as_str()),
        ("code_verifier", verifier.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri.as_str()),
    ];
    let response = http_client()?
        .post(TOKEN_ENDPOINT)
        .form(&form)
        .send()
        .map_err(|_| {
            AppError::new(
                "google.oauth_exchange_unavailable",
                "Google could not complete sign-in. Check your connection and try again.",
            )
            .retryable(true)
        })?;
    let tokens = parse_token_response(response, "sign-in")?;
    if let Some(granted) = tokens.scope.as_deref() {
        let granted = granted
            .split_whitespace()
            .collect::<std::collections::BTreeSet<_>>();
        if scopes(access).iter().any(|scope| !granted.contains(scope)) {
            return Err(AppError::new(
                "google.scope_missing",
                "Google did not grant every enabled Calendar and Tasks permission.",
            ));
        }
    }
    let refresh_token = tokens.refresh_token.ok_or_else(|| {
        AppError::new(
            "google.refresh_token_missing",
            "Google did not return a reusable sign-in token. Remove this app from your Google account and connect again.",
        )
    })?;
    Ok(GoogleAuthorization { refresh_token })
}

fn refresh_access_token(
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> AppResult<String> {
    let form = [
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];
    let response = http_client()?
        .post(TOKEN_ENDPOINT)
        .form(&form)
        .send()
        .map_err(|_| {
            AppError::new(
                "google.refresh_unavailable",
                "Google sync could not refresh the connection. Check your network and try again.",
            )
            .retryable(true)
        })?;
    parse_token_response(response, "connection refresh").map(|tokens| tokens.access_token)
}

pub fn revoke(refresh_token: &str) -> AppResult<()> {
    let response = http_client()?
        .post(REVOKE_ENDPOINT)
        .form(&[("token", refresh_token)])
        .send()
        .map_err(|_| {
            AppError::new(
                "google.revoke_unavailable",
                "Google could not be reached to revoke this connection.",
            )
            .retryable(true)
        })?;
    if response.status().is_success() || response.status() == StatusCode::BAD_REQUEST {
        Ok(())
    } else {
        Err(AppError::new(
            "google.revoke_failed",
            "Google could not revoke this connection.",
        ))
    }
}

pub struct LiveGoogleProvider {
    client: Client,
    access_token: String,
    task_sync_timestamp: String,
}

impl LiveGoogleProvider {
    pub fn connect(client_id: &str, client_secret: &str, refresh_token: &str) -> AppResult<Self> {
        Ok(Self {
            client: http_client()?,
            access_token: refresh_access_token(client_id, client_secret, refresh_token)?,
            task_sync_timestamp: crate::platform::SystemClock.now_utc(),
        })
    }

    pub fn task_lists(&self) -> AppResult<Vec<TaskListEntry>> {
        let mut items = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let mut url = Url::parse(TASK_LISTS_ENDPOINT).map_err(|_| {
                AppError::new("google.tasks_unavailable", "Google Tasks is unavailable.")
            })?;
            url.query_pairs_mut().append_pair("maxResults", "100");
            if let Some(token) = page_token.as_deref() {
                url.query_pairs_mut().append_pair("pageToken", token);
            }
            let response = self
                .client
                .get(url)
                .bearer_auth(&self.access_token)
                .send()
                .map_err(|_| provider_app_error("Google Tasks could not be reached."))?;
            let page = parse_provider_response::<TaskListsResponse>(response)
                .map_err(provider_to_app_error)?;
            items.extend(page.items.into_iter().map(|item| {
                let payload_hash = payload_hash(&item);
                TaskListEntry {
                    provider_id: item.id,
                    title: item.title,
                    etag: item.etag,
                    payload_hash,
                }
            }));
            match page.next_page_token {
                Some(token) => page_token = Some(token),
                None => return Ok(items),
            }
        }
    }

    pub fn create_task(
        &self,
        task_list_id: &str,
        title: &str,
        notes: Option<&str>,
        due: Option<&str>,
    ) -> AppResult<GoogleTask> {
        let url = task_collection_url(task_list_id)?;
        let response = self
            .client
            .post(url)
            .bearer_auth(&self.access_token)
            .json(&serde_json::json!({ "title": title, "notes": notes, "due": due }))
            .send()
            .map_err(|_| provider_app_error("Google Tasks could not be reached."))?;
        let task =
            parse_provider_response::<TaskResponse>(response).map_err(provider_to_app_error)?;
        Ok(task_response(task, task_list_id))
    }

    pub fn update_task(
        &self,
        task_list_id: &str,
        task_id: &str,
        title: &str,
        notes: Option<&str>,
        due: Option<&str>,
        status: &str,
    ) -> AppResult<GoogleTask> {
        let url = task_item_url(task_list_id, task_id)?;
        let response = self
            .client
            .patch(url)
            .bearer_auth(&self.access_token)
            .json(&serde_json::json!({
                "title": title,
                "notes": notes,
                "due": due,
                "status": status,
                "completed": if status == "completed" {
                    Some(crate::platform::SystemClock.now_utc())
                } else {
                    None
                },
            }))
            .send()
            .map_err(|_| provider_app_error("Google Tasks could not be reached."))?;
        let task =
            parse_provider_response::<TaskResponse>(response).map_err(provider_to_app_error)?;
        Ok(task_response(task, task_list_id))
    }

    pub fn delete_task(&self, task_list_id: &str, task_id: &str) -> AppResult<()> {
        let response = self
            .client
            .delete(task_item_url(task_list_id, task_id)?)
            .bearer_auth(&self.access_token)
            .send()
            .map_err(|_| provider_app_error("Google Tasks could not be reached."))?;
        parse_empty_provider_response(response).map_err(provider_to_app_error)
    }

    pub fn create_event(&self, payload: &serde_json::Value) -> AppResult<CalendarEvent> {
        let response = self
            .client
            .post(CALENDAR_EVENTS_ENDPOINT)
            .bearer_auth(&self.access_token)
            .json(payload)
            .send()
            .map_err(|_| provider_app_error("Google Calendar could not be reached."))?;
        let event = parse_provider_response::<CalendarEventResponse>(response)
            .map_err(provider_to_app_error)?;
        Ok(calendar_event_response(event))
    }

    pub fn update_event(
        &self,
        event_id: &str,
        payload: &serde_json::Value,
    ) -> AppResult<CalendarEvent> {
        let encoded_id =
            url::form_urlencoded::byte_serialize(event_id.as_bytes()).collect::<String>();
        let response = self
            .client
            .patch(format!("{CALENDAR_EVENTS_ENDPOINT}/{encoded_id}"))
            .bearer_auth(&self.access_token)
            .json(payload)
            .send()
            .map_err(|_| provider_app_error("Google Calendar could not be reached."))?;
        let event = parse_provider_response::<CalendarEventResponse>(response)
            .map_err(provider_to_app_error)?;
        Ok(calendar_event_response(event))
    }

    pub fn delete_event(&self, event_id: &str) -> AppResult<()> {
        let encoded_id =
            url::form_urlencoded::byte_serialize(event_id.as_bytes()).collect::<String>();
        let response = self
            .client
            .delete(format!("{CALENDAR_EVENTS_ENDPOINT}/{encoded_id}"))
            .bearer_auth(&self.access_token)
            .send()
            .map_err(|_| provider_app_error("Google Calendar could not be reached."))?;
        parse_empty_provider_response(response).map_err(provider_to_app_error)
    }
}

fn task_collection_url(task_list_id: &str) -> AppResult<String> {
    let encoded_id =
        url::form_urlencoded::byte_serialize(task_list_id.as_bytes()).collect::<String>();
    Ok(format!("{TASKS_ENDPOINT_PREFIX}{encoded_id}/tasks"))
}

fn task_item_url(task_list_id: &str, task_id: &str) -> AppResult<String> {
    let encoded_task = url::form_urlencoded::byte_serialize(task_id.as_bytes()).collect::<String>();
    Ok(format!(
        "{}/{encoded_task}",
        task_collection_url(task_list_id)?
    ))
}

fn task_response(item: TaskResponse, task_list_id: &str) -> GoogleTask {
    let payload_hash = payload_hash(&item);
    GoogleTask {
        provider_id: item.id,
        task_list_id: task_list_id.into(),
        title: item.title,
        notes: item.notes,
        due_date: item.due,
        status: item.status,
        deleted: item.deleted,
        etag: item.etag,
        updated_at: item.updated,
        payload_hash,
    }
}

fn calendar_event_response(item: CalendarEventResponse) -> CalendarEvent {
    let payload_hash = payload_hash(&item);
    let all_day = item.start.date.is_some();
    CalendarEvent {
        provider_id: item.id,
        calendar_id: "primary".into(),
        title: item.summary,
        description: item.description,
        location: item.location,
        start: item
            .start
            .date
            .clone()
            .or(item.start.date_time.clone())
            .unwrap_or_default(),
        end: item
            .end
            .date
            .clone()
            .or(item.end.date_time.clone())
            .unwrap_or_default(),
        timezone: item.start.time_zone.or(item.end.time_zone),
        all_day,
        recurring_series_id: item.recurring_event_id,
        deleted: item.status == "cancelled",
        etag: item.etag,
        updated_at: item.updated,
        payload_hash,
    }
}

fn provider_app_error(message: &str) -> AppError {
    AppError::new("google.sync_unavailable", message).retryable(true)
}

pub fn provider_to_app_error(error: ProviderError) -> AppError {
    match error {
        ProviderError::AuthRequired => AppError::new(
            "google.reconnect_required",
            "The Google connection expired or was revoked. Connect it again in Settings.",
        ),
        ProviderError::RepeatedGone410 => AppError::new(
            "google.sync_reset_failed",
            "Google Calendar could not restart synchronization.",
        ),
        ProviderError::Unavailable(message) => {
            AppError::new("google.sync_unavailable", message).retryable(true)
        }
        ProviderError::Terminal(message) => AppError::new("google.sync_failed", message),
    }
}

fn parse_provider_response<T: for<'de> Deserialize<'de>>(
    response: Response,
) -> Result<T, ProviderError> {
    match response.status() {
        StatusCode::UNAUTHORIZED => Err(ProviderError::AuthRequired),
        StatusCode::FORBIDDEN => Err(ProviderError::Terminal(
            "Google denied sync. Enable the Google Calendar and Tasks APIs and verify the consent-screen access for this account.".into(),
        )),
        StatusCode::GONE => Err(ProviderError::RepeatedGone410),
        status if status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS => Err(
            ProviderError::Unavailable("Google sync is temporarily unavailable.".into()),
        ),
        status if !status.is_success() => Err(ProviderError::Terminal(format!(
            "Google sync failed with HTTP status {}.",
            status.as_u16()
        ))),
        _ => response.json::<T>().map_err(|_| {
            ProviderError::Terminal("Google returned an unreadable sync response.".into())
        }),
    }
}

fn parse_empty_provider_response(response: Response) -> Result<(), ProviderError> {
    match response.status() {
        StatusCode::UNAUTHORIZED => Err(ProviderError::AuthRequired),
        StatusCode::FORBIDDEN => Err(ProviderError::Terminal(
            "Google denied this change. Reconnect with read and write access in Settings.".into(),
        )),
        status if status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS => Err(
            ProviderError::Unavailable("Google is temporarily unavailable.".into()),
        ),
        status if !status.is_success() => Err(ProviderError::Terminal(format!(
            "Google rejected the change with HTTP status {}.",
            status.as_u16()
        ))),
        _ => Ok(()),
    }
}

fn payload_hash(value: &impl serde::Serialize) -> String {
    serde_json::to_vec(value)
        .map(|bytes| blake3::hash(&bytes).to_hex().to_string())
        .unwrap_or_default()
}

impl GoogleProvider for LiveGoogleProvider {
    fn calendar_page(
        &mut self,
        _calendar_id: &str,
        sync_token: Option<&str>,
        page_token: Option<&str>,
    ) -> Result<SyncPage<CalendarEvent>, ProviderError> {
        let mut url = Url::parse(CALENDAR_EVENTS_ENDPOINT)
            .map_err(|_| ProviderError::Terminal("Google Calendar is unavailable.".into()))?;
        url.query_pairs_mut()
            .append_pair("singleEvents", "true")
            .append_pair("showDeleted", "true")
            .append_pair("maxResults", "2500");
        if let Some(token) = sync_token {
            url.query_pairs_mut().append_pair("syncToken", token);
        }
        if let Some(token) = page_token {
            url.query_pairs_mut().append_pair("pageToken", token);
        }
        let response = self
            .client
            .get(url)
            .bearer_auth(&self.access_token)
            .send()
            .map_err(|_| {
                ProviderError::Unavailable("Google Calendar could not be reached.".into())
            })?;
        if response.status() == StatusCode::GONE {
            return Ok(SyncPage::Gone410);
        }
        let page = parse_provider_response::<CalendarEventsResponse>(response)?;
        Ok(SyncPage::Data {
            items: page
                .items
                .into_iter()
                .map(calendar_event_response)
                .collect(),
            next_page_token: page.next_page_token,
            next_sync_token: page.next_sync_token,
        })
    }

    fn task_page(
        &mut self,
        task_list_id: &str,
        updated_min: Option<&str>,
        page_token: Option<&str>,
    ) -> Result<SyncPage<GoogleTask>, ProviderError> {
        let encoded_id =
            url::form_urlencoded::byte_serialize(task_list_id.as_bytes()).collect::<String>();
        let mut url = Url::parse(&format!("{TASKS_ENDPOINT_PREFIX}{encoded_id}/tasks"))
            .map_err(|_| ProviderError::Terminal("Google Tasks is unavailable.".into()))?;
        url.query_pairs_mut()
            .append_pair("showCompleted", "true")
            .append_pair("showDeleted", "true")
            .append_pair("showHidden", "true")
            .append_pair("maxResults", "100");
        if let Some(timestamp) = updated_min {
            url.query_pairs_mut().append_pair("updatedMin", timestamp);
        }
        if let Some(token) = page_token {
            url.query_pairs_mut().append_pair("pageToken", token);
        }
        let response = self
            .client
            .get(url)
            .bearer_auth(&self.access_token)
            .send()
            .map_err(|_| ProviderError::Unavailable("Google Tasks could not be reached.".into()))?;
        let page = parse_provider_response::<TasksResponse>(response)?;
        let last_page = page.next_page_token.is_none();
        Ok(SyncPage::Data {
            items: page
                .items
                .into_iter()
                .map(|item| task_response(item, task_list_id))
                .collect(),
            next_page_token: page.next_page_token,
            next_sync_token: last_page.then(|| self.task_sync_timestamp.clone()),
        })
    }

    fn mutate(
        &mut self,
        _operation: &crate::planner::google::OutboxOperation,
    ) -> crate::planner::google::MutationResponse {
        crate::planner::google::MutationResponse::Terminal("google.write_not_enabled".into())
    }
}

#[cfg(test)]
mod tests {
    use super::{GoogleAccess, authorization_url, pkce_challenge, scopes};

    #[test]
    fn scopes_only_include_enabled_services() {
        assert_eq!(
            scopes(GoogleAccess {
                read_write: false,
                calendar_enabled: false,
                tasks_enabled: true,
            }),
            ["https://www.googleapis.com/auth/tasks.readonly"]
        );
        assert_eq!(
            scopes(GoogleAccess {
                read_write: true,
                calendar_enabled: true,
                tasks_enabled: false,
            }),
            [
                "https://www.googleapis.com/auth/calendar.readonly",
                "https://www.googleapis.com/auth/calendar.events"
            ]
        );
    }

    #[test]
    fn authorization_uses_loopback_pkce_and_state() {
        let verifier = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHijklmno";
        let url = authorization_url(
            "client.apps.googleusercontent.com",
            "http://127.0.0.1:43210",
            "expected-state",
            verifier,
            GoogleAccess {
                read_write: false,
                calendar_enabled: true,
                tasks_enabled: true,
            },
        )
        .expect("authorization URL");
        let values = url
            .query_pairs()
            .collect::<std::collections::BTreeMap<_, _>>();
        assert_eq!(
            values.get("state").map(|value| value.as_ref()),
            Some("expected-state")
        );
        assert_eq!(
            values.get("code_challenge").map(|value| value.as_ref()),
            Some(pkce_challenge(verifier).as_str())
        );
        assert_eq!(
            values
                .get("code_challenge_method")
                .map(|value| value.as_ref()),
            Some("S256")
        );
        assert!(!values.contains_key("include_granted_scopes"));
    }

    #[test]
    fn token_errors_name_the_relevant_credentials() {
        for code in ["invalid_client", "redirect_uri_mismatch"] {
            let error = super::token_exchange_error("sign-in", Some(code));
            assert!(error.message.contains("Desktop app"));
        }
        let error = super::token_exchange_error("sign-in", Some("invalid_request"));
        assert!(error.message.contains("client ID and client secret"));
    }
}
