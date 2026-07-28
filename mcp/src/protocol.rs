use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};

pub const PROTOCOL_VERSION: u32 = 2;
pub const MAX_MESSAGE_BYTES: usize = 256 * 1024;
pub const MAX_PAGE_SIZE: u64 = 100;

const READ_TOOLS: &[&str] = &[
    "brain.search",
    "brain.get_context_packet",
    "brain.get_document_section",
    "brain.get_node",
    "brain.status",
    "workspace.get_manifest",
    "workspace.get_changes",
    "workspace.get_allowed_roots",
    "planner.read",
    "planner.list_events",
    "planner.get_event",
    "planner.list_tasks",
    "planner.get_task",
    "planner.find_free_time",
];

const WRITE_TOOLS: &[&str] = &[
    "brain.write_note",
    "brain.record_decision",
    "brain.update_task",
    "brain.link",
    "brain.archive",
    "brain.reindex",
    "workspace.write_text",
    "workspace.patch",
    "workspace.create_directory",
    "workspace.validate",
    "planner.create_event",
    "planner.update_event",
    "planner.move_event",
    "planner.delete_event",
    "planner.create_task",
    "planner.update_task",
    "planner.complete_task",
    "planner.move_task",
    "planner.delete_task",
    "planner.link",
    "planner.sync",
];

const PLANNER_RESOURCES: &[(&str, &str)] = &[
    ("planner://today", "Planner today"),
    ("planner://calendar", "Planner calendar"),
    ("planner://tasks", "Planner task lists"),
    ("planner://project-schedule", "Planner project schedule"),
    ("planner://availability", "Planner availability"),
];

#[derive(Debug, Deserialize)]
struct Request {
    jsonrpc: String,
    #[serde(default)]
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct Response {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ErrorObject>,
}

#[derive(Debug, Serialize)]
struct ErrorObject {
    code: i32,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolCall {
    name: String,
    #[serde(default)]
    arguments: Value,
    capability_token: String,
    agent_id: String,
    session_id: String,
    workspace_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceRead {
    uri: String,
    #[serde(default)]
    arguments: Value,
    capability_token: String,
    agent_id: String,
    session_id: String,
    workspace_id: String,
}

#[derive(Debug)]
pub enum GatewayError {
    Unauthorized,
    Forbidden,
    Conflict,
    Unavailable,
    Invalid(String),
}

pub struct RequestContext {
    pub capability_token: String,
    pub agent_id: String,
    pub session_id: String,
    pub workspace_id: String,
}

pub trait Gateway {
    fn call(
        &mut self,
        context: &RequestContext,
        tool: &str,
        arguments: Value,
    ) -> Result<Value, GatewayError>;
}

pub fn run(
    reader: impl BufRead,
    mut writer: impl Write,
    mut gateway: impl Gateway,
) -> io::Result<()> {
    for line in reader.lines() {
        let line = line?;
        let response = if line.len() > MAX_MESSAGE_BYTES {
            failure(Value::Null, -32600, "request exceeds the sidecar limit")
        } else {
            match serde_json::from_str::<Request>(&line) {
                Ok(request) => dispatch(request, &mut gateway),
                Err(_) => failure(Value::Null, -32700, "invalid JSON-RPC message"),
            }
        };
        serde_json::to_writer(&mut writer, &response)?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }
    Ok(())
}

fn dispatch(request: Request, gateway: &mut impl Gateway) -> Response {
    if request.jsonrpc != "2.0" {
        return failure(request.id, -32600, "jsonrpc must be 2.0");
    }
    match request.method.as_str() {
        "initialize" => initialize(request.id, request.params),
        "tools/list" => success(
            request.id,
            json!({ "tools": READ_TOOLS.iter().chain(WRITE_TOOLS).map(|name| json!({
                "name": name,
                "inputSchema": input_schema(name)
            })).collect::<Vec<_>>() }),
        ),
        "resources/list" => success(request.id, json!({ "resources": resource_list() })),
        "resources/read" => read_resource(request.id, request.params, gateway),
        "tools/call" => call_tool(request.id, request.params, gateway),
        _ => failure(request.id, -32601, "method not found"),
    }
}

fn read_resource(id: Value, params: Value, gateway: &mut impl Gateway) -> Response {
    let read = match serde_json::from_value::<ResourceRead>(params) {
        Ok(read) => read,
        Err(_) => return failure(id, -32602, "invalid resource read"),
    };
    if !PLANNER_RESOURCES.iter().any(|(uri, _)| *uri == read.uri) {
        return failure(id, -32602, "unknown planner resource");
    }
    let context = RequestContext {
        capability_token: read.capability_token,
        agent_id: read.agent_id,
        session_id: read.session_id,
        workspace_id: read.workspace_id,
    };
    match gateway.call(
        &context,
        "planner.read",
        json!({"uri":read.uri,"arguments":read.arguments}),
    ) {
        Ok(value) => success(id, json!({"contents":[{"uri":read.uri,"data":value}]})),
        Err(error) => gateway_failure(id, error),
    }
}

fn resource_list() -> Vec<Value> {
    [
        ("brain://status", "Brain status"),
        ("workspace://allowed-roots", "Allowed workspace roots"),
    ]
    .into_iter()
    .chain(PLANNER_RESOURCES.iter().copied())
    .map(|(uri, name)| json!({"uri":uri,"name":name}))
    .collect()
}

fn input_schema(name: &str) -> Value {
    match name {
        "planner.read" => object_schema(
            &["uri"],
            json!({
                "uri":{"type":"string","enum":PLANNER_RESOURCES.iter().map(|(uri, _)| *uri).collect::<Vec<_>>()},
                "date":{"type":"string","format":"date"},
                "timezone":{"type":"string"},
                "projectId":{"type":"string"},
                "limit":{"type":"integer","minimum":1,"maximum":MAX_PAGE_SIZE},
                "cursor":{"type":"string"}
            }),
        ),
        "planner.list_events" | "planner.find_free_time" => object_schema(
            &["startEpochSeconds", "endEpochSeconds", "timezone"],
            json!({
                "startEpochSeconds":{"type":"integer"},
                "endEpochSeconds":{"type":"integer"},
                "timezone":{"type":"string"},
                "calendarId":{"type":"string"},
                "limit":{"type":"integer","minimum":1,"maximum":MAX_PAGE_SIZE},
                "cursor":{"type":"string"}
            }),
        ),
        "planner.list_tasks" => object_schema(
            &[],
            json!({
                "taskListId":{"type":"string"},
                "status":{"type":"string","enum":["open","completed","all"]},
                "limit":{"type":"integer","minimum":1,"maximum":MAX_PAGE_SIZE},
                "cursor":{"type":"string"}
            }),
        ),
        "planner.get_event" | "planner.get_task" => {
            object_schema(&["id"], json!({"id":{"type":"string","minLength":1}}))
        }
        "planner.create_event" => object_schema(
            &[
                "title",
                "startEpochSeconds",
                "endEpochSeconds",
                "timezone",
                "accountId",
                "calendarId",
                "idempotencyKey",
            ],
            json!({
                "title":{"type":"string","minLength":1},
                "details":{"type":"string"},
                "startEpochSeconds":{"type":"integer"},
                "endEpochSeconds":{"type":"integer"},
                "timezone":{"type":"string","minLength":1},
                "accountId":{"type":"string","minLength":1},
                "calendarId":{"type":"string","minLength":1},
                "focusBlock":{"type":"boolean","default":true},
                "attendeeEmails":{"type":"array","items":{"type":"string","format":"email"}},
                "idempotencyKey":{"type":"string","minLength":1},
                "projectId":{"type":"string"},
                "sourceNoteId":{"type":"string"}
            }),
        ),
        "planner.create_task" => object_schema(
            &["title", "accountId", "taskListId", "idempotencyKey"],
            json!({
                "title":{"type":"string","minLength":1},
                "details":{"type":"string"},
                "dueDate":{"type":"string","format":"date"},
                "accountId":{"type":"string","minLength":1},
                "taskListId":{"type":"string","minLength":1},
                "idempotencyKey":{"type":"string","minLength":1},
                "projectId":{"type":"string"},
                "sourceNoteId":{"type":"string"}
            }),
        ),
        "planner.complete_task" => object_schema(
            &["id", "accountId", "taskListId", "idempotencyKey"],
            json!({
                "id":{"type":"string","minLength":1},
                "accountId":{"type":"string","minLength":1},
                "taskListId":{"type":"string","minLength":1},
                "idempotencyKey":{"type":"string","minLength":1}
            }),
        ),
        "planner.update_event"
        | "planner.move_event"
        | "planner.delete_event"
        | "planner.update_task"
        | "planner.move_task"
        | "planner.delete_task" => object_schema(
            &["id", "accountId", "idempotencyKey"],
            json!({
                "id":{"type":"string","minLength":1},
                "accountId":{"type":"string","minLength":1},
                "idempotencyKey":{"type":"string","minLength":1},
                "title":{"type":"string","minLength":1},
                "details":{"type":"string"},
                "dueDate":{"type":"string","format":"date"},
                "startEpochSeconds":{"type":"integer"},
                "endEpochSeconds":{"type":"integer"},
                "timezone":{"type":"string"},
                "destinationId":{"type":"string"}
            }),
        ),
        "planner.link" => object_schema(
            &["plannerItemId"],
            json!({
                "plannerItemId":{"type":"string","minLength":1},
                "projectId":{"type":"string"},
                "sourceNoteId":{"type":"string"}
            }),
        ),
        "planner.sync" => object_schema(
            &["accountId"],
            json!({
                "accountId":{"type":"string","minLength":1},
                "calendarId":{"type":"string"},
                "taskListId":{"type":"string"}
            }),
        ),
        _ => json!({"type":"object","additionalProperties":true}),
    }
}

fn object_schema(required: &[&str], properties: Value) -> Value {
    json!({
        "type":"object",
        "properties":properties,
        "required":required,
        "additionalProperties":false
    })
}

fn initialize(id: Value, params: Value) -> Response {
    let version = params
        .get("protocolVersion")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    if version != u64::from(PROTOCOL_VERSION) {
        return failure(
            id,
            -32001,
            &format!("protocol version mismatch: sidecar requires {PROTOCOL_VERSION}"),
        );
    }
    success(
        id,
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "serverInfo": {"name":"agent-os-mcp","version":env!("CARGO_PKG_VERSION")},
            "capabilities": {"tools":{}, "resources":{}}
        }),
    )
}

fn call_tool(id: Value, params: Value, gateway: &mut impl Gateway) -> Response {
    let call = match serde_json::from_value::<ToolCall>(params) {
        Ok(call) => call,
        Err(_) => return failure(id, -32602, "invalid tool call"),
    };
    if !READ_TOOLS.contains(&call.name.as_str()) && !WRITE_TOOLS.contains(&call.name.as_str()) {
        return failure(id, -32602, "unknown tool");
    }
    if let Some(limit) = call.arguments.get("limit").and_then(Value::as_u64)
        && limit > MAX_PAGE_SIZE
    {
        return failure(id, -32602, "page limit exceeds 100");
    }
    if call.name == "planner.find_free_time"
        || call.name == "planner.list_events"
        || call.name == "planner.create_event"
    {
        let start = call
            .arguments
            .get("startEpochSeconds")
            .and_then(Value::as_i64);
        let end = call
            .arguments
            .get("endEpochSeconds")
            .and_then(Value::as_i64);
        if start.zip(end).is_some_and(|(start, end)| {
            end <= start || end.saturating_sub(start) > 366 * 24 * 60 * 60
        }) {
            return failure(
                id,
                -32602,
                "planner time range is invalid or exceeds 366 days",
            );
        }
    }
    let context = RequestContext {
        capability_token: call.capability_token,
        agent_id: call.agent_id,
        session_id: call.session_id,
        workspace_id: call.workspace_id,
    };
    match gateway.call(&context, &call.name, call.arguments) {
        Ok(value) => success(id, value),
        Err(error) => gateway_failure(id, error),
    }
}

fn gateway_failure(id: Value, error: GatewayError) -> Response {
    let (code, message) = match error {
        GatewayError::Unauthorized => (-32010, "capability token rejected".to_owned()),
        GatewayError::Forbidden => (-32011, "tool is outside the granted capability".to_owned()),
        GatewayError::Conflict => (-32012, "the target changed; refresh and retry".to_owned()),
        GatewayError::Unavailable => (
            -32013,
            "the Second Brain OS app gateway is unavailable".to_owned(),
        ),
        GatewayError::Invalid(message) => (-32602, message),
    };
    failure(id, code, &message)
}

fn success(id: Value, result: Value) -> Response {
    Response {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    }
}

fn failure(id: Value, code: i32, message: &str) -> Response {
    Response {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(ErrorObject {
            code,
            message: message.to_owned(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    struct FakeGateway;

    impl Gateway for FakeGateway {
        fn call(
            &mut self,
            context: &RequestContext,
            tool: &str,
            arguments: Value,
        ) -> Result<Value, GatewayError> {
            assert_eq!(context.agent_id, "agent");
            assert_eq!(context.session_id, "session");
            assert_eq!(context.workspace_id, "workspace");
            assert_eq!(context.capability_token, "opaque");
            Ok(json!({"tool":tool,"query":arguments["query"],"items":[],"nextCursor":null}))
        }
    }

    fn exchange(lines: &str) -> Vec<Value> {
        let mut output = Vec::new();
        run(Cursor::new(lines), &mut output, FakeGateway).expect("protocol");
        String::from_utf8(output)
            .expect("utf8")
            .lines()
            .map(|line| serde_json::from_str(line).expect("response"))
            .collect()
    }

    #[test]
    fn negotiates_and_forwards_bounded_identity_bound_calls() {
        let responses = exchange(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":2}}\n\
             {\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"brain.search\",\"arguments\":{\"query\":\"index\",\"limit\":20},\"capabilityToken\":\"opaque\",\"agentId\":\"agent\",\"sessionId\":\"session\",\"workspaceId\":\"workspace\"}}\n",
        );
        assert_eq!(responses[0]["result"]["protocolVersion"], 2);
        assert_eq!(responses[1]["result"]["tool"], "brain.search");
        assert_eq!(responses[1]["result"]["query"], "index");
    }

    #[test]
    fn rejects_version_mismatch_malformed_and_oversized_pages() {
        let responses = exchange(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":1}}\n\
             nope\n\
             {\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"brain.search\",\"arguments\":{\"limit\":101},\"capabilityToken\":\"x\",\"agentId\":\"a\",\"sessionId\":\"s\",\"workspaceId\":\"w\"}}\n",
        );
        assert_eq!(responses[0]["error"]["code"], -32001);
        assert_eq!(responses[1]["error"]["code"], -32700);
        assert_eq!(responses[2]["error"]["code"], -32602);
    }

    #[test]
    fn advertises_explicit_planner_intent_and_bounds_ranges() {
        let responses = exchange(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n\
             {\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"resources/list\"}\n\
             {\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"planner.find_free_time\",\"arguments\":{\"startEpochSeconds\":0,\"endEpochSeconds\":40000000,\"timezone\":\"UTC\"},\"capabilityToken\":\"opaque\",\"agentId\":\"agent\",\"sessionId\":\"session\",\"workspaceId\":\"workspace\"}}\n\
             {\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"resources/read\",\"params\":{\"uri\":\"planner://today\",\"arguments\":{\"timezone\":\"UTC\"},\"capabilityToken\":\"opaque\",\"agentId\":\"agent\",\"sessionId\":\"session\",\"workspaceId\":\"workspace\"}}\n",
        );
        let tools = responses[0]["result"]["tools"].as_array().expect("tools");
        let create_task = tools
            .iter()
            .find(|tool| tool["name"] == "planner.create_task")
            .expect("task schema");
        assert!(create_task["inputSchema"]["properties"]["dueDate"].is_object());
        assert!(
            create_task["inputSchema"]["properties"]
                .get("startEpochSeconds")
                .is_none()
        );
        let create_event = tools
            .iter()
            .find(|tool| tool["name"] == "planner.create_event")
            .expect("event schema");
        assert_eq!(
            create_event["inputSchema"]["required"],
            json!([
                "title",
                "startEpochSeconds",
                "endEpochSeconds",
                "timezone",
                "accountId",
                "calendarId",
                "idempotencyKey"
            ])
        );
        assert!(
            responses[1]["result"]["resources"]
                .as_array()
                .expect("resources")
                .iter()
                .any(|resource| resource["uri"] == "planner://availability")
        );
        assert_eq!(responses[2]["error"]["code"], -32602);
        assert_eq!(
            responses[3]["result"]["contents"][0]["data"]["tool"],
            "planner.read"
        );
    }
}
