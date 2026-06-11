//! Connection passwords live in the macOS Keychain, one entry per profile id
//! under the "Strata" service. settings.json never sees a password — see
//! `commands::save_settings` (strip on write) and `lib::run` (hydrate on load).

use keyring::Entry;

const SERVICE: &str = "Strata";

fn entry(id: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, id).map_err(|e| e.to_string())
}

pub fn get(id: &str) -> Option<String> {
    entry(id).ok()?.get_password().ok()
}

pub fn set(id: &str, password: &str) -> Result<(), String> {
    entry(id)?.set_password(password).map_err(|e| e.to_string())
}

/// Best-effort removal — a missing entry is not an error.
pub fn delete(id: &str) {
    if let Ok(e) = entry(id) {
        let _ = e.delete_credential();
    }
}
