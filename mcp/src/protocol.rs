use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};

pub const PROTOCOL_VERSION: u32 = 1;
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
                "inputSchema": { "type": "object", "additionalProperties": true }
            })).collect::<Vec<_>>() }),
        ),
        "resources/list" => success(
            request.id,
            json!({ "resources": [
                {"uri":"brain://status","name":"Brain status"},
                {"uri":"workspace://allowed-roots","name":"Allowed workspace roots"}
            ] }),
        ),
        "tools/call" => call_tool(request.id, request.params, gateway),
        _ => failure(request.id, -32601, "method not found"),
    }
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
    let context = RequestContext {
        capability_token: call.capability_token,
        agent_id: call.agent_id,
        session_id: call.session_id,
        workspace_id: call.workspace_id,
    };
    match gateway.call(&context, &call.name, call.arguments) {
        Ok(value) => success(id, value),
        Err(error) => {
            let (code, message) = match error {
                GatewayError::Unauthorized => (-32010, "capability token rejected".to_owned()),
                GatewayError::Forbidden => {
                    (-32011, "tool is outside the granted capability".to_owned())
                }
                GatewayError::Conflict => {
                    (-32012, "the target changed; refresh and retry".to_owned())
                }
                GatewayError::Unavailable => (
                    -32013,
                    "the Second Brain OS app gateway is unavailable".to_owned(),
                ),
                GatewayError::Invalid(message) => (-32602, message),
            };
            failure(id, code, &message)
        }
    }
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
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":1}}\n\
             {\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"brain.search\",\"arguments\":{\"query\":\"index\",\"limit\":20},\"capabilityToken\":\"opaque\",\"agentId\":\"agent\",\"sessionId\":\"session\",\"workspaceId\":\"workspace\"}}\n",
        );
        assert_eq!(responses[0]["result"]["protocolVersion"], 1);
        assert_eq!(responses[1]["result"]["tool"], "brain.search");
        assert_eq!(responses[1]["result"]["query"], "index");
    }

    #[test]
    fn rejects_version_mismatch_malformed_and_oversized_pages() {
        let responses = exchange(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":2}}\n\
             nope\n\
             {\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"brain.search\",\"arguments\":{\"limit\":101},\"capabilityToken\":\"x\",\"agentId\":\"a\",\"sessionId\":\"s\",\"workspaceId\":\"w\"}}\n",
        );
        assert_eq!(responses[0]["error"]["code"], -32001);
        assert_eq!(responses[1]["error"]["code"], -32700);
        assert_eq!(responses[2]["error"]["code"], -32602);
    }
}
