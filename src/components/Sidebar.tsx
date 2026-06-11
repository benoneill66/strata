import { Icon } from "../lib/icons";
import { startWindowDrag } from "../lib/api";
import type { ConnectionProfile, DbInfo } from "../lib/types";

export type ViewId = "browse" | "query" | "settings";

const NAV: { id: ViewId; label: string; icon: (p?: { w?: number }) => React.JSX.Element }[] = [
  { id: "browse", label: "Browse", icon: Icon.table },
  { id: "query", label: "Query", icon: Icon.terminal },
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

      {/* ---------- connections ---------- */}
      <div className="no-drag" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 7px" }}>
        <span className="label" style={{ letterSpacing: "0.08em" }}>Connections</span>
        <button
          className="conn-add"
          title="New connection"
          onClick={onNew}
        >
          <Icon.plus w={13} />
        </button>
      </div>

      <div className="no-drag" style={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", maxHeight: "38vh", marginBottom: 4 }}>
        {connections.length === 0 ? (
          <button className="conn-empty" onClick={onNew}>
            <Icon.plus w={13} /> Add connection
          </button>
        ) : (
          connections.map((c) => {
            const info = connected[c.id];
            const isActive = activeId === c.id;
            const isBusy = busyId === c.id;
            return (
              <div
                key={c.id}
                className={`conn-item ${isActive ? "active" : ""}`}
                style={{ ["--c" as string]: c.color }}
                onClick={() => onSelect(c.id)}
                title={`${c.user}@${c.host}:${c.port}/${c.database}`}
              >
                <span className={`dot ${isBusy ? "running" : info ? "ok" : "idle"}`} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="conn-name">{c.name || c.host}</div>
                  {isActive && info && (
                    <div className="conn-sub mono">{info.database} · pg {info.version.split(".")[0]}</div>
                  )}
                </div>
                <div className="conn-actions">
                  {info && (
                    <button
                      title="Disconnect"
                      onClick={(e) => { e.stopPropagation(); onDisconnect(c.id); }}
                    >
                      <Icon.close w={12} />
                    </button>
                  )}
                  <button
                    title="Edit"
                    onClick={(e) => { e.stopPropagation(); onEdit(c); }}
                  >
                    <Icon.edit w={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ height: 1, background: "var(--hair-soft)", margin: "8px 6px 10px" }} />

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
