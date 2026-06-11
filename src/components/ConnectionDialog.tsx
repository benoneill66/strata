import { useState } from "react";
import { api } from "../lib/api";
import { Icon } from "../lib/icons";
import type { ConnectionProfile } from "../lib/types";
import { Dialog, Spinner } from "./ui";

export const COLORS = ["#4fa8ff", "#38d9c4", "#8b7cff", "#ffb454", "#ff5d7a", "#34e2a0"];

export function blankProfile(): ConnectionProfile {
  return {
    id: crypto.randomUUID(),
    name: "",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "",
    database: "postgres",
    ssl_mode: "prefer",
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
}

/** Add/edit a saved connection profile — host/user/db, SSL, colour, with a
    live Test button. Reused from the sidebar (no longer a full-screen tab). */
export function ConnectionDialog({
  profile,
  isNew,
  onSave,
  onDelete,
  onClose,
}: {
  profile: ConnectionProfile;
  isNew: boolean;
  onSave: (p: ConnectionProfile) => Promise<void>;
  onDelete: (p: ConnectionProfile) => Promise<void>;
  onClose: () => void;
}) {
  const [p, setP] = useState(profile);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const set = (patch: Partial<ConnectionProfile>) => { setP((s) => ({ ...s, ...patch })); setTestResult(null); };

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const version = await api.testConnection(p);
      setTestResult({ ok: true, msg: version.split(" on ")[0] || "Connected" });
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  const field = (label: string, el: React.ReactNode, span2 = false) => (
    <div style={{ gridColumn: span2 ? "span 2" : undefined }}>
      <div className="label" style={{ marginBottom: 6 }}>{label}</div>
      {el}
    </div>
  );

  return (
    <Dialog title={isNew ? "New connection" : "Edit connection"} onClose={onClose} width={520}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {field("Name", <input className="input" placeholder="Prod · core" value={p.name} onChange={(e) => set({ name: e.target.value })} />, true)}
        {field("Host", <input className="input" value={p.host} onChange={(e) => set({ host: e.target.value })} />)}
        {field("Port", <input className="input mono" type="number" value={p.port} onChange={(e) => set({ port: Number(e.target.value) || 5432 })} />)}
        {field("User", <input className="input" value={p.user} onChange={(e) => set({ user: e.target.value })} />)}
        {field("Password", <input className="input" type="password" value={p.password} onChange={(e) => set({ password: e.target.value })} />)}
        {field("Database", <input className="input" value={p.database} onChange={(e) => set({ database: e.target.value })} />)}
        {field("SSL", (
          <div className="seg" style={{ width: "100%" }}>
            {["prefer", "require", "disable"].map((m) => (
              <button key={m} className={p.ssl_mode === m ? "on" : ""} style={{ flex: 1 }} onClick={() => set({ ssl_mode: m })}>{m}</button>
            ))}
          </div>
        ))}
        {field("Colour", (
          <div style={{ display: "flex", gap: 8, alignItems: "center", height: 38 }}>
            {COLORS.map((col) => (
              <div key={col} onClick={() => set({ color: col })} style={{
                width: 22, height: 22, borderRadius: 7, background: col, cursor: "default",
                outline: p.color === col ? "2px solid rgba(255,255,255,0.7)" : "none", outlineOffset: 2,
              }} />
            ))}
          </div>
        ), true)}
      </div>

      {testResult && (
        <div className="rise" style={{
          marginTop: 14, padding: "10px 12px", borderRadius: 11, fontSize: 12.5, lineHeight: 1.45,
          background: testResult.ok ? "rgba(52,226,160,0.1)" : "rgba(255,93,122,0.1)",
          border: `1px solid ${testResult.ok ? "rgba(52,226,160,0.3)" : "rgba(255,93,122,0.3)"}`,
          color: testResult.ok ? "var(--ok)" : "var(--error)",
        }}>
          {testResult.msg}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        {!isNew && <button className="btn btn-danger btn-sm" onClick={() => onDelete(p)}><Icon.trash w={13} /> Delete</button>}
        <div style={{ flex: 1 }} />
        <button className="btn" disabled={testing} onClick={test}>{testing ? <Spinner size={13} /> : <Icon.zap w={13} />} Test</button>
        <button className="btn btn-primary" onClick={() => onSave(p)}><Icon.check w={14} /> Save</button>
      </div>
    </Dialog>
  );
}
