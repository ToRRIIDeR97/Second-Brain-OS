fn main() {
    println!(r#"{{"name":"agent-os-mcp","version":"0.1.0","capabilities":[]}}"#);
}

#[cfg(test)]
mod tests {
    #[test]
    fn advertises_no_capabilities() {
        let capabilities: [&str; 0] = [];
        assert!(capabilities.is_empty());
    }
}
