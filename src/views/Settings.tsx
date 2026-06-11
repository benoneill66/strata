import { api, IS_TAURI } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { Icon } from "../lib/icons";
import type { Settings as SettingsType } from "../lib/types";

const PAGE_SIZES = [100, 200, 500, 1000];

export function Settings({
  settings,
  onSettings,
}: {
  settings: SettingsType;
  onSettings: (s: SettingsType) => Promise<void>;
}) {
  const ai = useAsync(() => api.aiStatus(), []);
  return (
    <div className="rise" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 21, fontWeight: 720, letterSpacing: "-0.02em" }}>Settings</h1>
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 3 }}>Preferences are saved to the app-data dir.</div>
      </div>

      <div className="glass-card" style={{ padding: 18 }}>
        <div className="label" style={{ marginBottom: 8 }}>Default page size</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="seg">
            {PAGE_SIZES.map((n) => (
              <button
                key={n}
                className={settings.row_limit === n ? "on" : ""}
                onClick={() => onSettings({ ...settings, row_limit: n })}
              >
                {n}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>rows fetched per page when browsing tables</span>
        </div>
      </div>

      <div className="glass-card" style={{ padding: 18 }}>
        <div className="label" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ color: "var(--accent-2)", display: "flex" }}><Icon.sparkles w={14} /></span> AI SQL
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}>
          <span className={`dot ${ai.data?.available ? "ok" : "error"}`} />
          {ai.data?.available ? (
            <span>Enabled — ask questions in the <strong>Query</strong> view and Strata generates SQL via the Claude CLI.</span>
          ) : (
            <span style={{ color: "var(--muted)" }}>
              Claude CLI not found. Install with <span className="mono" style={{ fontSize: 12 }}>npm i -g @anthropic-ai/claude-code</span> and sign in, then reopen Strata.
            </span>
          )}
        </div>
        {ai.data?.available && ai.data.path !== "demo" && (
          <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>{ai.data.path}</div>
        )}
      </div>

      <div className="glass-card" style={{ padding: 18 }}>
        <div className="label" style={{ marginBottom: 10 }}>About</div>
        <div className="meta-grid">
          <span className="k">App</span><span className="v">Strata 1.0.0 — native Postgres browser</span>
          <span className="k">Mode</span><span className="v">{IS_TAURI ? "Native (Tauri)" : "Browser demo — fictional data"}</span>
          <span className="k">Storage</span><span className="v mono" style={{ fontSize: 12 }}>~/Library/Application Support/app.strata.desktop/settings.json</span>
          <span className="k">Note</span><span className="v" style={{ color: "var(--muted)" }}>Connection passwords are stored securely in the macOS Keychain, not in that file.</span>
        </div>
      </div>
    </div>
  );
}
