pub mod agents;
mod app;
pub mod commands;
pub mod db;
pub mod diagnostics;
pub mod errors;
pub mod events;
pub mod knowledge;
pub mod mcp;
pub mod planner;
pub mod platform;
pub mod terminal;
pub mod workspace;

pub use app::run;
