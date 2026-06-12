import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { bytes, elapsed, num } from "../lib/format";
import { Icon } from "../lib/icons";
import type { MonitorSnapshot } from "../lib/types";
import { DatabasePicker } from "../components/DatabasePicker";
import { Empty, Spinner } from "../components/ui";

type Rates = { tps: number; blocksPerSec: number; tempBytesPerSec: number } | null;

function pct(n: number) {
  return `${n.toFixed(n >= 99 ? 2 : 1)}%`;
}

function seconds(n: number) {
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${n % 60}s`;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  return `${h}h ${m}m`;
}

function shortSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

function resetAge(statsReset: string | null) {
  if (!statsReset) return "not reported";
  const d = new Date(statsReset);
  if (Number.isNaN(d.getTime())) return statsReset;
  return d.toLocaleString();
}

function activityTone(state: string) {
  if (state === "active") return "running";
  if (state === "idle in transaction") return "alert";
  return "idle";
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "ok" | "alert" | "error" | "running";
}) {
  return (
    <div className="glass-card" style={{ padding: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
        {tone && <span className={`dot ${tone}`} />}
        <span className="label">{label}</span>
      </div>
      <div className="stat-num" style={{ fontSize: 25 }}>{value}</div>
      {sub && <div style={{ marginTop: 7, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.35 }}>{sub}</div>}
    </div>
  );
}

function Section({
  title,
  icon,
  right,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card" style={{ padding: 14, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ display: "flex", color: "var(--accent-2)" }}>{icon}</span>
        <div style={{ fontSize: 13, fontWeight: 680 }}>{title}</div>
        <div style={{ flex: 1 }} />
        {right}
      </div>
      {children}
    </div>
  );
}

function MiniTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="data-wrap" style={{ flex: "none", maxHeight: 260 }}>
      <table className="data-table">{children}</table>
    </div>
  );
}

export function Monitor({
  connId,
  database,
  hasConnections,
  active,
  onNew,
  onSwitchDatabase,
}: {
  connId: string | null;
  database: string | null;
  hasConnections: boolean;
  active: boolean;
  onNew: () => void;
  onSwitchDatabase: (id: string, db: string) => Promise<void>;
}) {
  const [live, setLive] = useState(true);
  const [killingPid, setKillingPid] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const prev = useRef<MonitorSnapshot | null>(null);
  const [rates, setRates] = useState<Rates>(null);
  const snapshot = useAsync<MonitorSnapshot | null>(
    () => (active && connId ? api.monitorSnapshot(connId) : Promise.resolve(null)),
    [active, connId, database],
    active && live ? 5 : 0
  );

  useEffect(() => {
    if (!snapshot.data) return;
    const before = prev.current;
    if (before) {
      const dt = Math.max(1, (snapshot.data.sampled_at_ms - before.sampled_at_ms) / 1000);
      const txNow = snapshot.data.overview.xact_commit + snapshot.data.overview.xact_rollback;
      const txPrev = before.overview.xact_commit + before.overview.xact_rollback;
      const blocksNow = snapshot.data.overview.blks_hit + snapshot.data.overview.blks_read;
      const blocksPrev = before.overview.blks_hit + before.overview.blks_read;
      setRates({
        tps: Math.max(0, (txNow - txPrev) / dt),
        blocksPerSec: Math.max(0, (blocksNow - blocksPrev) / dt),
        tempBytesPerSec: Math.max(0, (snapshot.data.overview.temp_bytes - before.overview.temp_bytes) / dt),
      });
    }
    prev.current = snapshot.data;
  }, [snapshot.data]);

  async function killQuery(pid: number) {
    if (!connId) return;
    setKillingPid(pid);
    try {
      await api.terminateBackend(connId, pid);
      await snapshot.reload();
    } finally {
      setKillingPid(null);
    }
  }

  async function loadLogs() {
    if (!connId) return;
    setLogsLoading(true);
    try {
      const logLines = await api.serverLogs(connId, 50);
      setLogs(logLines);
    } catch (e) {
      setLogs([`Error loading logs: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setLogsLoading(false);
    }
  }

  useEffect(() => {
    if (active && connId && snapshot.data) {
      loadLogs();
    }
  }, [active, connId, snapshot.data]);

  if (!connId) {
    return hasConnections ? (
      <Empty
        title="Choose a connection"
        sub="Pick a server from the list on the left to monitor database activity."
        icon={<Icon.chart w={22} />}
      />
    ) : (
      <Empty
        title="No connections yet"
        sub="Add a Postgres server from the sidebar to see live database metrics."
        icon={<Icon.chart w={22} />}
        action={<button className="btn btn-primary" onClick={onNew}><Icon.plus w={13} /> New connection</button>}
      />
    );
  }

  const m = snapshot.data;
  const o = m?.overview;
  const connPct = o ? (o.total_connections / Math.max(1, o.max_connections)) * 100 : 0;

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 740, letterSpacing: "-0.02em" }}>Monitor</h1>
          {o && <span className="chip mono">{o.database}</span>}
        </div>
        {connId && database && (
          <DatabasePicker connId={connId} database={database} onSwitch={(db) => onSwitchDatabase(connId, db)} style={{ width: "clamp(150px, 20vw, 200px)" }} />
        )}
        <div style={{ flex: 1 }} />
        {m && <span className="chip mono">sampled {new Date(m.sampled_at_ms).toLocaleTimeString()}</span>}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }} title="Poll every 5 seconds">
          <button role="switch" aria-checked={live} className={`switch ${live ? "on" : ""}`} onClick={() => setLive((v) => !v)}>
            <span className="knob" />
          </button>
          <span style={{ fontSize: 11.5, color: live ? "var(--text)" : "var(--muted)" }} onClick={() => setLive((v) => !v)}>
            Live
          </span>
        </span>
        <button className="btn btn-sm" onClick={() => snapshot.reload()} disabled={snapshot.loading}>
          {snapshot.loading ? <Spinner size={13} /> : <Icon.refresh w={13} />}
        </button>
      </div>

      {snapshot.error && (
        <div className="glass-card" style={{ padding: "12px 14px", color: "var(--error)", fontSize: 12.5, border: "1px solid rgba(255,93,122,0.3)" }}>
          {snapshot.error}
        </div>
      )}

      {snapshot.loading && snapshot.initial && (
        <div className="glass-card" style={{ flex: 1, display: "grid", placeItems: "center" }}><Spinner size={20} /></div>
      )}

      {m && o && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <Metric label="Database size" value={bytes(o.size_bytes)} sub={`PostgreSQL ${o.server_version}`} />
            <Metric
              label="Connections"
              value={`${o.total_connections}/${o.max_connections}`}
              sub={`${o.active_connections} active · ${pct(connPct)} capacity`}
              tone={connPct > 85 ? "error" : connPct > 65 ? "alert" : "ok"}
            />
            <Metric
              label="Cache hit"
              value={pct(o.cache_hit_pct)}
              sub={`${bytes(o.blks_hit * 8192)} hit · ${bytes(o.blks_read * 8192)} read`}
              tone={o.cache_hit_pct < 95 ? "alert" : "ok"}
            />
            <Metric
              label="Transactions"
              value={rates ? `${rates.tps.toFixed(1)}/s` : num(o.xact_commit + o.xact_rollback)}
              sub={`${num(o.xact_commit)} commit · ${num(o.xact_rollback)} rollback`}
            />
            <Metric
              label="Waits"
              value={o.waiting_connections}
              sub={`${o.idle_in_transaction} idle in transaction · ${o.deadlocks} deadlocks`}
              tone={o.waiting_connections || o.idle_in_transaction ? "alert" : "ok"}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(auto, 200px)", gap: 12, minHeight: 0 }}>
            <Section
              title="Activity"
              icon={<Icon.terminal w={14} />}
              right={<span className="chip mono">{m.activity.length} sessions</span>}
            >
              {m.activity.length ? (
                <MiniTable>
                  <thead>
                    <tr><th>PID</th><th>User</th><th>State</th><th>Wait</th><th>Time</th><th>Query</th><th></th></tr>
                  </thead>
                  <tbody>
                    {m.activity.map((a) => (
                      <tr key={a.pid}>
                        <td>{a.pid}</td>
                        <td>{a.user}</td>
                        <td><span className={`dot ${activityTone(a.state)}`} style={{ marginRight: 7 }} />{a.state || "unknown"}</td>
                        <td>{a.wait || "—"}</td>
                        <td>{seconds(a.duration_seconds)}</td>
                        <td title={shortSql(a.query)}>{shortSql(a.query) || "—"}</td>
                        <td style={{ textAlign: "right", paddingRight: 8 }}>
                          <button
                            className="btn btn-sm"
                            onClick={() => killQuery(a.pid)}
                            disabled={killingPid !== null}
                            title="Terminate this backend"
                            style={{ color: "var(--error)" }}
                          >
                            {killingPid === a.pid ? <Spinner size={11} /> : <Icon.close w={11} />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </MiniTable>
              ) : (
                <div style={{ color: "var(--muted)", fontSize: 12.5 }}>No other sessions visible for this database.</div>
              )}
            </Section>

            <Section title="Stats" icon={<Icon.chart w={14} />}>
              <div className="meta-grid">
                <span className="k">Uptime</span><span className="v mono">{seconds(o.uptime_seconds)}</span>
                <span className="k">Stats reset</span><span className="v">{resetAge(o.stats_reset)}</span>
                <span className="k">Block rate</span><span className="v mono">{rates ? `${rates.blocksPerSec.toFixed(0)}/s` : "sampling..."}</span>
                <span className="k">Temp writes</span><span className="v mono">{bytes(o.temp_bytes)}{rates ? ` · ${bytes(rates.tempBytesPerSec)}/s` : ""}</span>
              </div>
            </Section>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(500px, 1fr))", gap: 12, minHeight: 0 }}>
            <Section
              title="Table Health"
              icon={<Icon.table w={14} />}
              right={<span className="chip mono">largest {m.tables.length}</span>}
            >
              <MiniTable>
                <thead>
                  <tr><th>Table</th><th>Size</th><th>Live</th><th>Dead</th><th>Seq</th><th>Idx</th><th>Vacuum</th></tr>
                </thead>
                <tbody>
                  {m.tables.map((t) => (
                    <tr key={`${t.schema}.${t.table}`}>
                      <td>{t.schema}.{t.table}</td>
                      <td>{bytes(t.size_bytes)}</td>
                      <td>{num(t.live_rows)}</td>
                      <td>{num(t.dead_rows)}</td>
                      <td>{num(t.seq_scan)}</td>
                      <td>{num(t.idx_scan)}</td>
                      <td title={t.last_vacuum ?? ""}>{t.last_vacuum ? new Date(t.last_vacuum).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </MiniTable>
            </Section>

            <Section
              title="Locks"
              icon={<Icon.key w={14} />}
              right={<span className={`chip mono`} style={{ color: m.locks.length ? "var(--alert)" : "var(--muted)" }}>{m.locks.length} blocked</span>}
            >
              {m.locks.length ? (
                <MiniTable>
                  <thead>
                    <tr><th>Blocked</th><th>Blocking</th><th>Lock</th><th>Relation</th><th>Time</th><th>Query</th></tr>
                  </thead>
                  <tbody>
                    {m.locks.map((l) => (
                      <tr key={`${l.blocked_pid}:${l.blocking_pid}:${l.mode}`}>
                        <td>{l.blocked_pid}</td>
                        <td>{l.blocking_pid}</td>
                        <td>{l.mode}</td>
                        <td>{l.relation || l.locktype}</td>
                        <td>{seconds(l.duration_seconds)}</td>
                        <td title={shortSql(l.blocked_query)}>{shortSql(l.blocked_query)}</td>
                      </tr>
                    ))}
                  </tbody>
                </MiniTable>
              ) : (
                <div style={{ color: "var(--muted)", fontSize: 12.5 }}>No blocked lock waits in this database.</div>
              )}
            </Section>
          </div>

          <Section
            title="Top Statements"
            icon={<Icon.zap w={14} />}
            right={m.statements_available ? <span className="chip mono">pg_stat_statements</span> : <span className="chip">extension unavailable</span>}
          >
            {m.statements_available && m.statements.length ? (
              <MiniTable>
                <thead>
                  <tr><th>Total</th><th>Mean</th><th>Calls</th><th>Rows</th><th>Query</th></tr>
                </thead>
                <tbody>
                  {m.statements.map((s, i) => (
                    <tr key={`${i}:${s.query}`}>
                      <td>{elapsed(s.total_ms)}</td>
                      <td>{elapsed(s.mean_ms)}</td>
                      <td>{num(s.calls)}</td>
                      <td>{num(s.rows)}</td>
                      <td title={shortSql(s.query)}>{shortSql(s.query)}</td>
                    </tr>
                  ))}
                </tbody>
              </MiniTable>
            ) : (
              <div style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.5 }}>
                {m.statements_error ?? "Enable pg_stat_statements on this server to see query-level timing."}
              </div>
            )}
          </Section>

          <Section
            title="Server Logs"
            icon={<Icon.terminal w={14} />}
            right={<button className="btn btn-sm" onClick={loadLogs} disabled={logsLoading}>{logsLoading ? <Spinner size={11} /> : <Icon.refresh w={11} />}</button>}
          >
            {logs.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 240, overflowY: "auto", fontSize: 11.5, fontFamily: "SF Mono, ui-monospace, monospace", lineHeight: 1.4, color: "var(--muted)" }}>
                {logs.map((line, i) => (
                  <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{line}</div>
                ))}
              </div>
            ) : (
              <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
                {logsLoading ? "Loading logs..." : "Click refresh to load server logs"}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
