import { Icon } from "../lib/icons";
import { startWindowDrag } from "../lib/api";
import type { ConnectionProfile, DbInfo } from "../lib/types";
import { ConnectionPicker } from "./ConnectionPicker";

export type ViewId = "browse" | "schema" | "query" | "monitor" | "settings";

const NAV: { id: ViewId; label: string; icon: (p?: { w?: number }) => React.JSX.Element }[] = [
  { id: "browse", label: "Browse", icon: Icon.table },
  { id: "schema", label: "Schema", icon: Icon.graph },
  { id: "query", label: "Query", icon: Icon.terminal },
  { id: "monitor", label: "Monitor", icon: Icon.chart },
];

export function Sidebar({
  view,
  setView,
  connections,
  connected,
  activeId,
  busyId,
  onSelect,
  onDisconnect,
  onEdit,
  onNew,
}: {
  view: ViewId;
  setView: (v: ViewId) => void;
  connections: ConnectionProfile[];
  connected: Record<string, DbInfo>;
  activeId: string | null;
  busyId: string | null;
  onSelect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onEdit: (p: ConnectionProfile) => void;
  onNew: () => void;
}) {
  const hasConn = activeId !== null && connected[activeId];

  return (
    <aside onMouseDown={startWindowDrag} style={{ width: 232, flexShrink: 0, padding: "0 14px 14px", display: "flex", flexDirection: "column", height: "100%" }}>
      {/* clear the traffic lights */}
      <div style={{ height: 52 }} />

      <div className="no-drag" style={{ display: "flex", alignItems: "center", gap: 11, padding: "4px 8px 16px" }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
          boxShadow: "0 6px 18px -6px rgba(79,168,255,0.9)",
          display: "grid", placeItems: "center", color: "#06121d",
        }}>
          <Icon.layers w={18} />
        </div>
        <div>
          <div style={{ fontWeight: 740, fontSize: 15, lineHeight: 1, letterSpacing: "-0.02em" }}>Strata</div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3, letterSpacing: "0.06em" }}>POSTGRES BROWSER</div>
        </div>
      </div>

      {/* ---------- connection switcher ---------- */}
      <div className="no-drag" style={{ padding: "0 2px 4px" }}>
        <span className="label" style={{ letterSpacing: "0.08em", padding: "0 6px" }}>Connection</span>
      </div>
      <div className="no-drag" style={{ padding: "0 2px 4px" }}>
        <ConnectionPicker
          connections={connections}
          connected={connected}
          activeId={activeId}
          busyId={busyId}
          onSelect={onSelect}
          onDisconnect={onDisconnect}
          onEdit={onEdit}
          onNew={onNew}
        />
      </div>

      <div style={{ height: 1, background: "var(--hair-soft)", margin: "10px 6px 10px" }} />

      {/* ---------- workspace ---------- */}
      <nav className="no-drag" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {NAV.map((n) => (
          <div
            key={n.id}
            className={`nav-item ${view === n.id ? "active" : ""} ${!hasConn ? "disabled" : ""}`}
            onClick={() => setView(n.id)}
          >
            <n.icon />
            <span style={{ flex: 1 }}>{n.label}</span>
          </div>
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      <div className="no-drag" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}>
          <Icon.settings />
          <span>Settings</span>
        </div>
      </div>
    </aside>
  );
}
