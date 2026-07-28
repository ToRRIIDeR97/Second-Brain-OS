use std::collections::BTreeSet;
use std::time::{Duration, Instant};

use second_brain_os_lib::errors::redact_json;
use second_brain_os_lib::mcp::{
    CapabilityClaims, CapabilityError, CapabilityIssuer, CapabilityRequest, MCP_PROTOCOL_VERSION,
};
use second_brain_os_lib::workspace::{PathPolicyError, WorkspaceId, WorkspacePath};
use serde_json::json;

fn claims() -> CapabilityClaims {
    CapabilityClaims {
        token_id: "hardening-token".into(),
        agent_id: "agent".into(),
        session_id: "session".into(),
        workspace_id: "workspace".into(),
        tools: BTreeSet::from(["workspace.write_text".into()]),
        readable_roots: BTreeSet::from(["notes".into()]),
        writable_roots: BTreeSet::from(["notes".into()]),
        issued_at: 100,
        expires_at: 200,
        policy_revision: 7,
        protocol_version: MCP_PROTOCOL_VERSION,
    }
}

#[test]
fn adversarial_inputs_fail_closed_and_secrets_are_redacted() {
    let workspace_id = WorkspaceId::from("workspace");
    for path in [
        "../secret",
        "/etc/passwd",
        r"C:\secret",
        "%2e%2e/secret",
        "%252e%252e/secret",
        "notes/%00.md",
    ] {
        assert!(matches!(
            WorkspacePath::new(workspace_id.clone(), path),
            Err(PathPolicyError::InvalidPath(_))
        ));
    }

    let issuer = CapabilityIssuer::new([35; 32]);
    let token = issuer.issue(&claims()).expect("token");
    let mut request = CapabilityRequest {
        agent_id: "agent",
        session_id: "session",
        workspace_id: "workspace",
        tool: "workspace.write_text",
        relative_path: Some("notes/safe.md"),
        write: true,
        policy_revision: 7,
        now: 150,
    };
    assert!(issuer.authorize(&token, &request).is_ok());
    request.relative_path = Some("../secret");
    assert_eq!(
        issuer.authorize(&token, &request),
        Err(CapabilityError::PathDenied)
    );
    request.relative_path = Some("notes/safe.md");
    request.policy_revision = 8;
    assert_eq!(
        issuer.authorize(&token, &request),
        Err(CapabilityError::PolicyChanged)
    );
    let mut forged = token.into_bytes();
    forged[0] = if forged[0] == b'0' { b'1' } else { b'0' };
    assert_eq!(
        issuer.authorize(
            &String::from_utf8(forged).expect("token encoding"),
            &request
        ),
        Err(CapabilityError::Invalid)
    );

    let redacted = redact_json(&json!({
        "authorization": "Bearer secret",
        "nested": {"refresh_token": "refresh", "message": "token sk-live"},
    }));
    let serialized = serde_json::to_string(&redacted).expect("json");
    assert!(!serialized.contains("secret"));
    assert_ne!(redacted["nested"]["refresh_token"], "refresh");
    assert!(!serialized.contains("sk-live"));
}

#[test]
fn policy_hot_paths_stay_within_smoke_budget() {
    const OPERATIONS: usize = 10_000;
    const BUDGET: Duration = Duration::from_secs(2);
    let workspace_id = WorkspaceId::from("workspace");
    let path_start = Instant::now();
    for index in 0..OPERATIONS {
        WorkspacePath::new(workspace_id.clone(), format!("notes/{index}.md")).expect("valid path");
    }
    let path_elapsed = path_start.elapsed();

    let issuer = CapabilityIssuer::new([35; 32]);
    let token = issuer.issue(&claims()).expect("token");
    let request = CapabilityRequest {
        agent_id: "agent",
        session_id: "session",
        workspace_id: "workspace",
        tool: "workspace.write_text",
        relative_path: Some("notes/safe.md"),
        write: true,
        policy_revision: 7,
        now: 150,
    };
    let capability_start = Instant::now();
    for _ in 0..OPERATIONS {
        issuer.authorize(&token, &request).expect("authorization");
    }
    let capability_elapsed = capability_start.elapsed();

    eprintln!(
        "hardening performance: {OPERATIONS} paths={path_elapsed:?}, {OPERATIONS} authorizations={capability_elapsed:?}"
    );
    assert!(path_elapsed < BUDGET, "path policy smoke budget exceeded");
    assert!(
        capability_elapsed < BUDGET,
        "capability smoke budget exceeded"
    );
}
