import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { bytes, elapsed, estRows, num } from "../lib/format";
import { Icon } from "../lib/icons";
import { FILTER_OPS, TABLE_KINDS } from "../lib/types";
import type { Filter, FilterOp } from "../lib/types";
import { DataGrid } from "../components/DataGrid";
import { DatabasePicker } from "../components/DatabasePicker";
import { CopyBtn, Empty, Spinner, toast } from "../components/ui";

const PAGE_SIZES = [100, 200, 500, 1000];

export function Browse({
  connId,
  database,
  defaultLimit,
  hasConnections,
  onNew,
  onSwitchDatabase,
}: {
  connId: string | null;
  database: string | null;
  defaultLimit: number;
  hasConnections: boolean;
  onNew: () => void;
  onSwitchDatabase: (id: string, db: string) => Promise<void>;
}) {
  const [schema, setSchema] = useState<string | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"data" | "structure">("data");

  // grid state
  const [limit, setLimit] = useState(defaultLimit);
  const [offset, setOffset] = useState(0);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [detail, setDetail] = useState<(string | null)[] | null>(null);

  // Switching database reopens the connection against a different catalog, so
  // drop the current schema/table selection and let the defaults re-pick.
  useEffect(() => {
    setSchema(null);
    setTable(null);
  }, [database]);

  const schemas = useAsync(() => (connId ? api.listSchemas(connId) : Promise.resolve([])), [connId, database]);

  // pick a default schema once loaded
  useEffect(() => {
    if (!schema && schemas.data?.length) {
      const pub = schemas.data.find((s) => s.name === "public");
      setSchema((pub ?? schemas.data[0]).name);
    }
  }, [schemas.data, schema]);

  const tables = useAsync(
    () => (connId && schema ? api.listTables(connId, schema) : Promise.resolve([])),
    [connId, database, schema]
  );

  function selectTable(name: string) {
    setTable(name);
    setTab("data");
    setOffset(0);
    setSortCol(null);
    setSortDesc(false);
    setFilters([]);
    setCount(null);
    setDetail(null);
  }

  const columns = useAsync(
    () => (connId && schema && table ? api.tableColumns(connId, schema, table) : Promise.resolve([])),
    [connId, schema, table]
  );

  const rows = useAsync(
    () =>
      connId && schema && table
        ? api.tableRows(connId, schema, table, limit, offset, sortCol, sortDesc, filters)
        : Promise.resolve(null),
    [connId, schema, table, limit, offset, sortCol, sortDesc, filters]
  );

  // count is invalidated when filters change
  useEffect(() => setCount(null), [filters, table, schema]);

  async function fetchCount() {
    if (!connId || !schema || !table) return;
    setCounting(true);
    try {
      setCount(await api.tableCount(connId, schema, table, filters));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setCounting(false);
    }
  }

  function onSort(col: string) {
    setOffset(0);
    if (sortCol === col) {
      if (sortDesc) { setSortCol(null); setSortDesc(false); }
      else setSortDesc(true);
    } else {
      setSortCol(col);
      setSortDesc(false);
    }
  }

  const pkCols = useMemo(() => new Set((columns.data ?? []).filter((c) => c.is_pk).map((c) => c.name)), [columns.data]);
  const tableInfo = tables.data?.find((t) => t.name === table) ?? null;
  const filteredTables = (tables.data ?? []).filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));

  if (!connId) {
    return hasConnections ? (
      <Empty
        title="Choose a connection"
        sub="Pick a server from the list on the left to connect, then browse its schemas and tables here."
        icon={<Icon.plug w={22} />}
      />
    ) : (
      <Empty
        title="No connections yet"
        sub="Add your first Postgres server — host, user and database, just like pgAdmin but without the ceremony."
        icon={<Icon.plug w={22} />}
        action={<button className="btn btn-primary" onClick={onNew}><Icon.plus w={13} /> New connection</button>}
      />
    );
  }

  return (
    <div className="fade" style={{ display: "flex", gap: 14, height: "100%", minHeight: 0 }}>
      {/* ---------- left: schema + tables ---------- */}
      <div className="glass-card" style={{ width: 232, flexShrink: 0, padding: 12, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
        {connId && database && (
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Database</div>
            <DatabasePicker connId={connId} database={database} onSwitch={(db) => onSwitchDatabase(connId, db)} />
          </div>
        )}
        <div className="label" style={{ marginTop: 2 }}>Schema</div>
        <select
          className="input"
          style={{ padding: "8px 10px", fontSize: 13, marginTop: -4 }}
          value={schema ?? ""}
          onChange={(e) => { setSchema(e.target.value); setTable(null); }}
        >
          {(schemas.data ?? []).map((s) => (
            <option key={s.name} value={s.name}>{s.name} ({s.tables})</option>
          ))}
        </select>

        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", display: "flex" }}>
            <Icon.search w={13} />
          </span>
          <input
            className="input"
            style={{ padding: "7px 10px 7px 30px", fontSize: 12.5 }}
            placeholder="Filter tables…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={{ overflowY: "auto", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          {tables.loading && tables.initial && (
            <div style={{ padding: 14, display: "flex", justifyContent: "center" }}><Spinner /></div>
          )}
          {filteredTables.map((t) => (
            <div key={t.name} className={`tbl-item ${table === t.name ? "active" : ""}`} onClick={() => selectTable(t.name)}>
              <span style={{ display: "flex", opacity: 0.7 }}>
                {t.kind === "v" || t.kind === "m" ? <Icon.eye w={13} /> : <Icon.table w={13} />}
              </span>
              <span className="nm">{t.name}</span>
              <span className="mono" style={{ fontSize: 10, opacity: 0.55 }}>{estRows(t.est_rows)}</span>
            </div>
          ))}
          {!tables.loading && filteredTables.length === 0 && (
            <div style={{ padding: 14, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>No tables</div>
          )}
        </div>
      </div>

      {/* ---------- main ---------- */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
        {!table ? (
          <Empty
            title="Pick a table"
            sub="Select a table on the left to view its data instantly — filter, sort and page without writing SQL."
            icon={<Icon.table w={22} />}
          />
        ) : (
          <>
            {/* header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }} className="mono">{schema}.{table}</span>
                {tableInfo && (
                  <>
                    <span className="chip">{TABLE_KINDS[tableInfo.kind] ?? tableInfo.kind}</span>
                    <span className="chip mono">{bytes(tableInfo.size_bytes)}</span>
                    <span className="chip mono">~{estRows(tableInfo.est_rows)} rows</span>
                  </>
                )}
              </div>
              <div style={{ flex: 1 }} />
              <div className="seg">
                <button className={tab === "data" ? "on" : ""} onClick={() => setTab("data")}>Data</button>
                <button className={tab === "structure" ? "on" : ""} onClick={() => setTab("structure")}>Structure</button>
              </div>
              <button className="btn btn-sm" onClick={() => rows.reload()}>
                {rows.loading ? <Spinner size={13} /> : <Icon.refresh w={13} />}
              </button>
            </div>

            {tab === "structure" ? (
              <StructurePanel columns={columns.data ?? []} loading={columns.loading} />
            ) : (
              <>
                {/* filter bar */}
                <FilterBar
                  columns={(columns.data ?? []).map((c) => c.name)}
                  filters={filters}
                  setFilters={(f) => { setFilters(f); setOffset(0); }}
                />

                {rows.error && (
                  <div className="glass-card" style={{ padding: "12px 14px", color: "var(--error)", fontSize: 12.5, border: "1px solid rgba(255,93,122,0.3)" }}>
                    {rows.error}
                  </div>
                )}

                {rows.data && (
                  <DataGrid
                    result={rows.data}
                    startIndex={offset}
                    sortCol={sortCol}
                    sortDesc={sortDesc}
                    onSort={onSort}
                    onRowClick={setDetail}
                    pkCols={pkCols}
                  />
                )}
                {rows.loading && rows.initial && (
                  <div className="glass-card" style={{ flex: 1, display: "grid", placeItems: "center" }}><Spinner size={20} /></div>
                )}

                {/* footer / pagination */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--muted)" }}>
                  <span className="mono">
                    {rows.data ? `${num(offset + 1)}–${num(offset + rows.data.rows.length)}` : "—"}
                    {count !== null && ` of ${num(count)}`}
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={fetchCount} disabled={counting}>
                    {counting ? <Spinner size={12} /> : <Icon.zap w={12} />} {count === null ? "Count" : "Recount"}
                  </button>
                  {rows.data && <span className="chip mono"><Icon.clock w={11} /> {elapsed(rows.data.elapsed_ms)}</span>}
                  <div style={{ flex: 1 }} />
                  <div className="seg">
                    {PAGE_SIZES.map((n) => (
                      <button key={n} className={limit === n ? "on" : ""} onClick={() => { setLimit(n); setOffset(0); }}>{n}</button>
                    ))}
                  </div>
                  <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
                    <Icon.chevLeft w={13} />
                  </button>
                  <button className="btn btn-sm" disabled={!rows.data || rows.data.rows.length < limit} onClick={() => setOffset(offset + limit)}>
                    <Icon.chevRight w={13} />
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* row detail drawer */}
      {detail && rows.data && (
        <RowDrawer columns={rows.data.columns} row={detail} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

// ---------- filters ----------

function FilterBar({
  columns,
  filters,
  setFilters,
}: {
  columns: string[];
  filters: Filter[];
  setFilters: (f: Filter[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [col, setCol] = useState("");
  const [op, setOp] = useState<FilterOp>("contains");
  const [value, setValue] = useState("");

  const needsValue = FILTER_OPS.find((o) => o.id === op)?.needsValue ?? true;

  function add() {
    const column = col || columns[0];
    if (!column) return;
    setFilters([...filters, { column, op, value: needsValue ? value : "" }]);
    setAdding(false);
    setCol("");
    setValue("");
    setOp("contains");
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {filters.map((f, i) => (
        <span key={i} className="chip" style={{ padding: "5px 10px", color: "var(--text)", background: "rgba(79,168,255,0.12)", borderColor: "rgba(79,168,255,0.3)" }}>
          <span className="mono" style={{ fontSize: 11.5 }}>
            {f.column} {FILTER_OPS.find((o) => o.id === f.op)?.label} {f.value && `“${f.value}”`}
          </span>
          <span style={{ display: "flex", cursor: "default", opacity: 0.7 }} onClick={() => setFilters(filters.filter((_, j) => j !== i))}>
            <Icon.close w={11} />
          </span>
        </span>
      ))}

      {adding ? (
        <span className="glass-card fade" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: 6, borderRadius: 12 }}>
          <select className="input" style={{ width: 150, padding: "5px 8px", fontSize: 12 }} value={col || columns[0] || ""} onChange={(e) => setCol(e.target.value)}>
            {columns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input" style={{ width: 105, padding: "5px 8px", fontSize: 12 }} value={op} onChange={(e) => setOp(e.target.value as FilterOp)}>
            {FILTER_OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {needsValue && (
            <input
              className="input mono"
              style={{ width: 160, padding: "5px 8px", fontSize: 12 }}
              autoFocus
              placeholder="value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
          )}
          <button className="btn btn-sm btn-primary" onClick={add}><Icon.check w={12} /></button>
          <button className="btn btn-sm btn-ghost" onClick={() => setAdding(false)}><Icon.close w={12} /></button>
        </span>
      ) : (
        <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
          <Icon.filter w={12} /> Add filter
        </button>
      )}
      {filters.length > 0 && !adding && (
        <button className="btn btn-ghost btn-sm" style={{ color: "var(--muted)" }} onClick={() => setFilters([])}>Clear</button>
      )}
    </div>
  );
}

// ---------- structure ----------

function StructurePanel({ columns, loading }: { columns: { name: string; data_type: string; nullable: boolean; is_pk: boolean; default: string | null }[]; loading: boolean }) {
  if (loading && !columns.length) {
    return <div className="glass-card" style={{ flex: 1, display: "grid", placeItems: "center" }}><Spinner size={20} /></div>;
  }
  return (
    <div className="data-wrap no-drag fade">
      <table className="data-table">
        <thead>
          <tr><th className="idx">#</th><th>COLUMN</th><th>TYPE</th><th>NULLABLE</th><th>DEFAULT</th></tr>
        </thead>
        <tbody>
          {columns.map((c, i) => (
            <tr key={c.name}>
              <td className="idx">{i + 1}</td>
              <td>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {c.is_pk && <span style={{ color: "var(--accent)" }}><Icon.key w={11} /></span>}
                  <span style={{ fontWeight: c.is_pk ? 650 : 400 }}>{c.name}</span>
                </span>
              </td>
              <td style={{ color: "var(--accent-2)" }}>{c.data_type}</td>
              <td className={c.nullable ? "" : "null"}>{c.nullable ? "yes" : "no"}</td>
              <td className={c.default ? "" : "null"}>{c.default ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- row detail drawer ----------

function RowDrawer({ columns, row, onClose }: { columns: string[]; row: (string | null)[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const json = JSON.stringify(Object.fromEntries(columns.map((c, i) => [c, row[i]])), null, 2);

  // Portal to <body> — see Dialog in components/ui.tsx.
  return createPortal(
    <>
      <div className="drawer-scrim no-drag" onClick={onClose} />
      <div className="drawer no-drag">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 12px" }}>
          <div style={{ fontSize: 15, fontWeight: 680 }}>Row detail</div>
          <div style={{ display: "flex", gap: 8 }}>
            <CopyBtn text={json} label="Copy JSON" />
            <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: 6 }}><Icon.close w={15} /></button>
          </div>
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: "8px 20px 20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {columns.map((c, i) => (
              <div key={c} className="glass-card" style={{ padding: "10px 13px", borderRadius: 13 }}>
                <div className="label" style={{ marginBottom: 5 }}>{c}</div>
                <div className="mono" style={{ fontSize: 12.5, lineHeight: 1.5, wordBreak: "break-word", whiteSpace: "pre-wrap", color: row[i] === null ? "var(--muted)" : "var(--text)", fontStyle: row[i] === null ? "italic" : "normal", maxHeight: 220, overflowY: "auto" }}>
                  {row[i] ?? "NULL"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
