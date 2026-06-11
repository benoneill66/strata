import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { estRows } from "../lib/format";
import { Icon } from "../lib/icons";
import type { ConnectionProfile, DbInfo } from "../lib/types";
import { toast } from "./ui";
import type { ViewId } from "./Sidebar";

/** ⌘K command palette: fuzzy-jump to any table, connection, database, view
    or recent query. Data loads lazily when the palette opens. */

// must match HISTORY_KEY in views/Query.tsx
const HISTORY_KEY = "strata.query-history";

interface Item {
  id: string;
  section: string;
  label: string;
  sub?: string;
  mono?: boolean;
  icon: React.ReactNode;
  run: () => void;
}

/** Subsequence fuzzy score: 0 = no match; consecutive runs and word starts
    score higher, shorter targets win ties. */
function fuzzy(q: string, text: string): number {
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const c of q) {
    const idx = t.indexOf(c, ti);
    if (idx === -1) return 0;
    streak = idx === ti ? streak + 1 : 1;
    score += streak * 2 + (idx === 0 || !/[a-z0-9]/.test(t[idx - 1]) ? 4 : 0);
    ti = idx + 1;
  }
  return score + Math.max(0, 30 - t.length) * 0.1;
}

const SECTION_ORDER = ["Tables", "Recent queries", "Connections", "Databases", "Actions"];

export function CommandPalette({
  open,
  onClose,
  connId,
  database,
  connections,
  connected,
  onSelectConnection,
  onSwitchDatabase,
  onJumpTable,
  onSeedQuery,
  onView,
  onNewConnection,
}: {
  open: boolean;
  onClose: () => void;
  connId: string | null;
  database: string | null;
  connections: ConnectionProfile[];
  connected: Record<string, DbInfo>;
  onSelectConnection: (id: string) => void;
  onSwitchDatabase: (db: string) => Promise<void>;
  onJumpTable: (schema: string, table: string) => void;
  onSeedQuery: (sql: string) => void;
  onView: (v: ViewId) => void;
  onNewConnection: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // lazy data: only fetched while the palette is open
  const tables = useAsync(
    () => (open && connId ? api.listAllTables(connId) : Promise.resolve([])),
    [open, connId, database]
  );
  const databases = useAsync(
    () => (open && connId ? api.listDatabases(connId) : Promise.resolve([])),
    [open, connId]
  );

  const history = useMemo<string[]>(() => {
    if (!open) return [];
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    } catch {
      return [];
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [];

    if (connId) {
      for (const t of tables.data ?? []) {
        all.push({
          id: `t:${t.schema}.${t.name}`,
          section: "Tables",
          label: `${t.schema}.${t.name}`,
          sub: t.kind === "v" || t.kind === "m" ? "view" : `~${estRows(t.est_rows)} rows`,
          mono: true,
          icon: t.kind === "v" || t.kind === "m" ? <Icon.eye w={13} /> : <Icon.table w={13} />,
          run: () => onJumpTable(t.schema, t.name),
        });
      }
      for (const db of databases.data ?? []) {
        if (db === database) continue;
        all.push({
          id: `d:${db}`,
          section: "Databases",
          label: db,
          sub: "switch database",
          mono: true,
          icon: <Icon.database w={13} />,
          run: () => {
            onSwitchDatabase(db).catch((e) => toast(e instanceof Error ? e.message : String(e), "error"));
          },
        });
      }
      for (const h of history.slice(0, 15)) {
        all.push({
          id: `h:${h}`,
          section: "Recent queries",
          label: h.replace(/\s+/g, " ").slice(0, 90),
          mono: true,
          icon: <Icon.history w={13} />,
          run: () => onSeedQuery(h),
        });
      }
    }

    for (const c of connections) {
      all.push({
        id: `c:${c.id}`,
        section: "Connections",
        label: c.name || c.host,
        sub: connected[c.id] ? (c.id === connId ? "active" : "connected") : c.host,
        icon: <span style={{ color: connected[c.id] ? "var(--ok)" : "var(--muted)", display: "flex" }}><Icon.plug w={13} /></span>,
        run: () => onSelectConnection(c.id),
      });
    }

    const views: { id: ViewId; label: string; icon: React.ReactNode }[] = [
      { id: "browse", label: "Go to Browse", icon: <Icon.table w={13} /> },
      { id: "schema", label: "Go to Schema", icon: <Icon.graph w={13} /> },
      { id: "query", label: "Go to Query", icon: <Icon.terminal w={13} /> },
      { id: "settings", label: "Go to Settings", icon: <Icon.settings w={13} /> },
    ];
    for (const v of views) {
      all.push({ id: `v:${v.id}`, section: "Actions", label: v.label, icon: v.icon, run: () => onView(v.id) });
    }
    all.push({
      id: "a:new-connection",
      section: "Actions",
      label: "New connection",
      icon: <Icon.plus w={13} />,
      run: onNewConnection,
    });

    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, database, tables.data, databases.data, history, connections, connected]);

  const visible = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    let picked: Item[];
    if (!q) {
      // default mix: actions + connections up top feel noisy — lead with tables
      picked = [
        ...items.filter((i) => i.section === "Tables").slice(0, 10),
        ...items.filter((i) => i.section === "Recent queries").slice(0, 3),
        ...items.filter((i) => i.section === "Connections").slice(0, 4),
        ...items.filter((i) => i.section === "Actions"),
      ];
    } else {
      picked = items
        .map((i) => ({ i, s: fuzzy(q, i.label) }))
        .filter(({ s }) => s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 40)
        .map(({ i }) => i);
    }
    // stable section grouping, preserving rank inside each section
    return SECTION_ORDER.flatMap((sec) => picked.filter((i) => i.section === sec));
  }, [items, query]);

  useEffect(() => setSel(0), [query, visible.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${sel}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  function pick(item: Item) {
    onClose();
    item.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (visible[sel]) pick(visible[sel]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  let lastSection = "";

  return createPortal(
    <div className="drawer-scrim no-drag" onClick={onClose} style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "15vh" }}>
      <div className="glass-card rise palette" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 15px", borderBottom: "1px solid var(--hair-soft)" }}>
          <span style={{ color: "var(--muted)", display: "flex" }}><Icon.search w={15} /></span>
          <input
            className="palette-input"
            autoFocus
            placeholder="Jump to a table, connection, query…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
          {(tables.loading || databases.loading) && connId && (
            <span className="spin" style={{ display: "flex", color: "var(--muted)" }}><Icon.refresh w={13} /></span>
          )}
          <span className="chip" style={{ fontSize: 10 }}>esc</span>
        </div>
        <div ref={listRef} style={{ overflowY: "auto", maxHeight: "52vh", padding: 6 }}>
          {visible.map((item, idx) => {
            const header = item.section !== lastSection ? item.section : null;
            lastSection = item.section;
            return (
              <div key={item.id}>
                {header && <div className="palette-section">{header}</div>}
                <div
                  data-idx={idx}
                  className={`palette-item ${idx === sel ? "active" : ""}`}
                  onMouseMove={() => setSel(idx)}
                  onClick={() => pick(item)}
                >
                  <span style={{ display: "flex", opacity: 0.75, flexShrink: 0 }}>{item.icon}</span>
                  <span className={item.mono ? "mono" : ""} style={{ fontSize: item.mono ? 12 : 12.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.label}
                  </span>
                  {item.sub && (
                    <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {item.sub}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {visible.length === 0 && (
            <div style={{ padding: "26px 0", textAlign: "center", color: "var(--muted)", fontSize: 12.5 }}>
              No matches{!connId && " — connect to a server to search its tables"}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
