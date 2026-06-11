import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../lib/icons";
import type { ConnectionProfile, DbInfo } from "../lib/types";

/** Collapsed connection switcher: a single trigger showing the active server,
    opening a dropdown of all saved connections. The menu is portaled to
    <body> (position:fixed gets clipped inside animated ancestors in WKWebView,
    same as the dialogs). */
export function ConnectionPicker({
  connections,
  connected,
  activeId,
  busyId,
  onSelect,
  onDisconnect,
  onEdit,
  onNew,
}: {
  connections: ConnectionProfile[];
  connected: Record<string, DbInfo>;
  activeId: string | null;
  busyId: string | null;
  onSelect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onEdit: (p: ConnectionProfile) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const active = activeId ? connections.find((c) => c.id === activeId) ?? null : null;
  const activeInfo = activeId ? connected[activeId] ?? null : null;

  useLayoutEffect(() => {
    if (open && triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onResize = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize); };
  }, [open]);

  function pick(id: string) {
    setOpen(false);
    onSelect(id);
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="conn-trigger no-drag"
        style={active ? { ["--c" as string]: active.color } : undefined}
        onClick={() => (connections.length ? setOpen((o) => !o) : onNew())}
        title={active ? `${active.user}@${active.host}:${active.port}/${active.database}` : "Choose a connection"}
      >
        <span className={`dot ${activeId && busyId === activeId ? "running" : activeInfo ? "ok" : "idle"}`} />
        <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
          <div className="conn-name">{active ? active.name || active.host : "No connection"}</div>
          <div className="conn-sub mono">
            {activeInfo ? `${activeInfo.database} · pg ${activeInfo.version.split(".")[0]}` : active ? "Click to connect" : "Add a server"}
          </div>
        </div>
        <span style={{ display: "flex", color: "var(--muted)", flexShrink: 0 }}><Icon.chevDown w={13} /></span>
      </button>

      {open && rect && createPortal(
        <>
          <div className="conn-menu-scrim no-drag" onClick={() => setOpen(false)} />
          <div
            className="conn-menu no-drag fade"
            style={{ position: "fixed", top: rect.bottom + 6, left: rect.left, width: rect.width }}
          >
            {connections.map((c) => {
              const info = connected[c.id];
              const isActive = activeId === c.id;
              const isBusy = busyId === c.id;
              return (
                <div
                  key={c.id}
                  className={`conn-menu-item ${isActive ? "active" : ""}`}
                  style={{ ["--c" as string]: c.color }}
                  onClick={() => pick(c.id)}
                  title={`${c.user}@${c.host}:${c.port}/${c.database}`}
                >
                  <span className={`dot ${isBusy ? "running" : info ? "ok" : "idle"}`} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="conn-name">{c.name || c.host}</div>
                    <div className="conn-sub mono">{c.host}:{c.port}</div>
                  </div>
                  <div className="conn-actions">
                    {info && (
                      <button title="Disconnect" onClick={(e) => { e.stopPropagation(); onDisconnect(c.id); }}>
                        <Icon.close w={12} />
                      </button>
                    )}
                    <button title="Edit" onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit(c); }}>
                      <Icon.edit w={12} />
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="conn-menu-sep" />
            <div className="conn-menu-item add" onClick={() => { setOpen(false); onNew(); }}>
              <span style={{ display: "grid", placeItems: "center", width: 8 }}><Icon.plus w={13} /></span>
              <span className="conn-name" style={{ color: "var(--muted)" }}>New connection</span>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}
