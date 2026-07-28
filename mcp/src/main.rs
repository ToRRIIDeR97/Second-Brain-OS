pub mod protocol;

use protocol::{Gateway, GatewayError, RequestContext, run};
use serde_json::Value;
use std::io;

struct AppGatewayUnavailable;

impl Gateway for AppGatewayUnavailable {
    fn call(
        &mut self,
        _context: &RequestContext,
        _tool: &str,
        _arguments: Value,
    ) -> Result<Value, GatewayError> {
        Err(GatewayError::Unavailable)
    }
}

fn main() {
    if let Err(error) = run(
        io::stdin().lock(),
        io::stdout().lock(),
        AppGatewayUnavailable,
    ) {
        eprintln!("agent-os-mcp: {error}");
        std::process::exit(1);
    }
}
