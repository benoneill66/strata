import { api, IS_TAURI, openExternal } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { Icon } from "../lib/icons";
import type { AiProvider, Settings as SettingsType } from "../lib/types";

const PAGE_SIZES = [100, 200, 500, 1000];
const AI_PROVIDERS: { id: AiProvider; label: string; install: string }[] = [
  { id: "claude", label: "Claude", install: "Install Claude Code and sign in." },
  { id: "codex", label: "Codex", install: "Install Codex CLI and run codex login." },
];

function providerLabel(provider: AiProvider) {
  return AI_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
}

export function Settings({
  settings,
  onSettings,
}: {
  settings: SettingsType;
  onSettings: (s: SettingsType) => Promise<void>;
}) {
  const ai = useAsync(() => api.aiStatus(), [settings.ai_provider]);
  const selectedProvider = providerLabel(settings.ai_provider);
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
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <div className="seg">
            {AI_PROVIDERS.map((p) => (
              <button
                key={p.id}
                className={settings.ai_provider === p.id ? "on" : ""}
                onClick={() => onSettings({ ...settings, ai_provider: p.id })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>provider for Ask AI and plan diagnosis</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}>
          <span className={`dot ${ai.data?.available ? "ok" : "error"}`} />
          {ai.data?.available ? (
            <span>
              Enabled — Strata generates SQL via the <strong>{selectedProvider}</strong> CLI
              {ai.data.model && <> with <span className="mono" style={{ fontSize: 12 }}>{ai.data.model}</span> / {ai.data.effort} effort</>}.
            </span>
          ) : (
            <span style={{ color: "var(--muted)" }}>
              {selectedProvider} CLI not found. {AI_PROVIDERS.find((p) => p.id === settings.ai_provider)?.install}
            </span>
          )}
        </div>
        {ai.data?.available && ai.data.path !== "demo" && (
          <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>{ai.data.path}</div>
        )}
        {ai.data && ai.data.path !== "demo" && (ai.data.claude_path || ai.data.codex_path) && (
          <div className="meta-grid" style={{ marginTop: 12 }}>
            <span className="k">Claude</span><span className="v mono" style={{ fontSize: 11 }}>{ai.data.claude_path || "not found"}</span>
            <span className="k">Codex</span><span className="v mono" style={{ fontSize: 11 }}>{ai.data.codex_path || "not found"}</span>
          </div>
        )}
      </div>

      <div className="glass-card" style={{ padding: 18 }}>
        <div className="label" style={{ marginBottom: 4 }}>Support Strata</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: "var(--muted)", flex: 1, minWidth: 200 }}>
            Strata is free and built by one person. If it saves you time, you can chip in.
          </div>
          <button
            className="btn"
            onClick={() => openExternal("https://buymeacoffee.com/benoneill")}
            style={{ background: "#FFDD00", color: "#1a1300", borderColor: "#e6c700", fontWeight: 640, whiteSpace: "nowrap" }}
          >
            <Icon.coffee w={15} /> Buy me a coffee
          </button>
        </div>
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
