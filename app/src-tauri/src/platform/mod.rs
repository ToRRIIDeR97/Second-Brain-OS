//! Native platform adapters used by the application kernel.

pub mod app_data;
pub mod clock;
pub mod logging;

pub use app_data::{AppDataLayout, application_data_dir, ensure_application_data_dir};
pub use clock::{Clock, FixedClock, FixedIdGenerator, IdGenerator, SystemClock, UlidGenerator};
