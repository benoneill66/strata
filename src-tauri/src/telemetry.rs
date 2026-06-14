//! Lightweight, anonymous usage telemetry.
//!
//! On launch Strata sends a single fire-and-forget `app_opened` event to
//! PostHog so we can count installs and active users. The *only* identifier is
//! a random per-install UUID (`Settings::install_id`, persisted in
//! settings.json); no connection details, hostnames, queries, or personal data
//! ever leave the machine.
//!
//! It is off whenever any of these hold:
//!   * the user turned it off in Settings (`telemetry_enabled = false`),
//!   * `DO_NOT_TRACK` is set to a non-empty / non-zero value, or
//!   * this is a debug build (so dev launches don't pollute the data set).
//!     Set `STRATA_TELEMETRY=1` to force-enable a debug build for testing.
//!
//! The PostHog *project* key below is a write-only ingest key — it is designed
//! to ship in client code and is safe to commit to a public repo. It can only
//! send events, never read data.

const POSTHOG_KEY: &str = "phc_qXvnV7ivhu8dZAeMcdFwUah4ymKBUGYkqPhxViiViCyQ";
const POSTHOG_HOST: &str = "https://eu.i.posthog.com";

/// True when the user has asked, via the environment, not to be tracked.
/// Honors the cross-tool `DO_NOT_TRACK` convention (https://consoledonottrack.com).
fn do_not_track() -> bool {
    matches!(std::env::var("DO_NOT_TRACK"), Ok(v) if !v.is_empty() && v != "0")
}

/// Whether a launch ping should be sent given the user's setting and env.
pub fn enabled(setting: bool) -> bool {
    if !setting || do_not_track() {
        return false;
    }
    // Don't report from un-configured builds or our own dev launches.
    if POSTHOG_KEY.starts_with("phc_REPLACE") {
        return false;
    }
    if cfg!(debug_assertions) && std::env::var("STRATA_TELEMETRY").is_err() {
        return false;
    }
    true
}

/// Fire the launch event on a detached thread. Never blocks startup and
/// silently swallows any network/HTTP error — telemetry must never affect the
/// app. Caller is responsible for gating on [`enabled`].
pub fn record_launch(install_id: String) {
    std::thread::spawn(move || {
        let body = serde_json::json!({
            "api_key": POSTHOG_KEY,
            "event": "app_opened",
            "distinct_id": install_id,
            "properties": {
                "$lib": "strata",
                "app_version": env!("CARGO_PKG_VERSION"),
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
            },
        });
        let _ = ureq::post(&format!("{POSTHOG_HOST}/capture/"))
            .timeout(std::time::Duration::from_secs(10))
            .send_json(body);
    });
}
