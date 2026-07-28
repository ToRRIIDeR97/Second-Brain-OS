//! Release channels and risky-feature defaults.

use std::collections::BTreeSet;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReleaseChannel {
    Developer,
    Alpha,
    Beta,
    Stable,
}

impl FromStr for ReleaseChannel {
    type Err = &'static str;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "developer" => Ok(Self::Developer),
            "alpha" => Ok(Self::Alpha),
            "beta" => Ok(Self::Beta),
            "stable" => Ok(Self::Stable),
            _ => Err("unknown release channel"),
        }
    }
}

impl ReleaseChannel {
    #[must_use]
    pub const fn identifier(self) -> &'static str {
        match self {
            Self::Developer => "com.secondbrain.os.developer",
            Self::Alpha => "com.secondbrain.os.alpha",
            Self::Beta => "com.secondbrain.os.beta",
            Self::Stable => "com.secondbrain.os",
        }
    }

    /// Logical feed names only. The updater remains disabled until rollback is
    /// proven and production feed URLs/signatures exist.
    #[must_use]
    pub const fn update_feed(self) -> &'static str {
        match self {
            Self::Developer => "developer.json",
            Self::Alpha => "alpha.json",
            Self::Beta => "beta.json",
            Self::Stable => "stable.json",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum FeatureFlag {
    SemanticRetrieval,
    ManagedClaude,
    RawHtml,
    GoogleWrites,
    Recurrence,
    AutomaticAgentWrites,
    BackgroundDerivedExtraction,
    LargeGraphViews,
    AutoUpdate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseRegistry {
    pub channel: ReleaseChannel,
    enabled: BTreeSet<FeatureFlag>,
}

impl ReleaseRegistry {
    #[must_use]
    pub fn for_channel(channel: ReleaseChannel) -> Self {
        let enabled = match channel {
            ReleaseChannel::Developer => [
                FeatureFlag::SemanticRetrieval,
                FeatureFlag::ManagedClaude,
                FeatureFlag::RawHtml,
                FeatureFlag::GoogleWrites,
                FeatureFlag::Recurrence,
                FeatureFlag::AutomaticAgentWrites,
                FeatureFlag::BackgroundDerivedExtraction,
                FeatureFlag::LargeGraphViews,
            ]
            .into_iter()
            .collect(),
            ReleaseChannel::Alpha => [
                FeatureFlag::SemanticRetrieval,
                FeatureFlag::ManagedClaude,
                FeatureFlag::GoogleWrites,
                FeatureFlag::Recurrence,
            ]
            .into_iter()
            .collect(),
            ReleaseChannel::Beta => [FeatureFlag::SemanticRetrieval, FeatureFlag::GoogleWrites]
                .into_iter()
                .collect(),
            ReleaseChannel::Stable => BTreeSet::new(),
        };
        Self { channel, enabled }
    }

    #[must_use]
    pub fn enabled(&self, feature: FeatureFlag) -> bool {
        self.enabled.contains(&feature)
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::{FeatureFlag, ReleaseChannel, ReleaseRegistry};

    #[test]
    fn channels_are_distinct_and_risky_defaults_fail_closed() {
        let channels = [
            ReleaseChannel::Developer,
            ReleaseChannel::Alpha,
            ReleaseChannel::Beta,
            ReleaseChannel::Stable,
        ];
        assert_eq!(
            channels
                .iter()
                .map(|channel| channel.identifier())
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            channels.len()
        );
        assert_eq!(
            channels
                .iter()
                .map(|channel| channel.update_feed())
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            channels.len()
        );
        assert!(ReleaseChannel::from_str("preview").is_err());
        for channel in channels {
            assert!(!ReleaseRegistry::for_channel(channel).enabled(FeatureFlag::AutoUpdate));
        }
        assert!(
            ReleaseRegistry::for_channel(ReleaseChannel::Developer).enabled(FeatureFlag::RawHtml)
        );
        assert!(!ReleaseRegistry::for_channel(ReleaseChannel::Beta).enabled(FeatureFlag::RawHtml));
        assert!(
            !ReleaseRegistry::for_channel(ReleaseChannel::Stable)
                .enabled(FeatureFlag::SemanticRetrieval)
        );
    }
}
