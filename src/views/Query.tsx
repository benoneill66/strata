import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { elapsed, num } from "../lib/format";
import { Icon } from "../lib/icons";
import type { QueryResult } from "../lib/types";
import { DataGrid } from "../components/DataGrid";
import { DatabasePicker } from "../components/DatabasePicker";
import { PlanView } from "../components/PlanView";
import { CopyBtn, Empty, Spinner, toast } from "../components/ui";

/** A query is safe to auto-run if it only reads. */
function isReadOnly(sql: string): boolean {
  const s = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").trim().toLowerCase();
  if (!/^(select|with|explain|show|table|values)\b/.test(s)) return false;
  return !/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|merge|call|do|vacuum|reindex|copy)\b/.test(s);
}

const HISTORY_KEY = "strata.query-history";
const MAX_HISTORY = 50;
const AUTORUN_KEY = "strata.ai-autorun";

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function Query({
  connId,
  database,
  hasConnections,
  onNew,
  onSwitchDatabase,
  seedSql,
}: {
  connId: string | null;
  database: string | null;
  hasConnections: boolean;
  onNew: () => void;
  onSwitchDatabase: (id: string, db: string) => Promise<void>;
  /** ⌘K palette: drop a recent query into the editor (seq bumps every time). */
  seedSql?: { sql: string; seq: number } | null;
}) {
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // AI: ask in English, get SQL into the editor (auto-run when read-only).
  const ai = useAsync(() => api.aiStatus(), []);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  // Opt-in: run generated SQL immediately (read-only queries only). Off by default.
  const [autoRun, setAutoRun] = useState(() => localStorage.getItem(AUTORUN_KEY) === "1");

  function toggleAutoRun() {
    setAutoRun((v) => {
      localStorage.setItem(AUTORUN_KEY, v ? "0" : "1");
      return !v;
    });
  }

  // EXPLAIN visualizer: plan JSON + whether it carries real (ANALYZE) timings
  const [plan, setPlan] = useState<{ json: string; analyzed: boolean; sql: string } | null>(null);
  const [explaining, setExplaining] = useState(false);

  function pushHistory(q: string) {
    setHistory((prev) => {
      const next = [q, ...prev.filter((h) => h !== q)].slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function runSql(q: string) {
    q = q.trim();
    if (!q || !connId) return;
    setRunning(true);
    setError(null);
    setPlan(null);
    try {
      const res = await api.runQuery(connId, q, 2000);
      setResult(res);
      pushHistory(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  async function explain(analyze: boolean) {
    const q = sql.trim();
    if (!q || !connId || explaining) return;
    setExplaining(true);
    setError(null);
    try {
      const json = await api.explainQuery(connId, q, analyze);
      setPlan({ json, analyzed: analyze, sql: q });
      setResult(null);
      pushHistory(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPlan(null);
    } finally {
      setExplaining(false);
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || !connId || asking) return;
    setAsking(true);
    setError(null);
    setExplanation(null);
    try {
      const s = await api.generateSql(connId, q);
      setSql(s.sql);
      setExplanation(s.explanation || null);
      if (autoRun && isReadOnly(s.sql)) {
        await runSql(s.sql);
      } else {
        if (autoRun && !isReadOnly(s.sql)) toast("Generated a write query — review it, then Run.", "info");
        editorRef.current?.focus();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  }

  // ⌘K palette: load a recent query into the editor for review (never auto-runs)
  useEffect(() => {
    if (!seedSql) return;
    setSql(seedSql.sql);
    setResult(null);
    setPlan(null);
    setError(null);
    editorRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedSql?.seq]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        runSql(sql);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, connId]);

  if (!connId) {
    return hasConnections ? (
      <Empty
        title="Choose a connection"
        sub="Pick a server from the list on the left to connect, then run SQL against it here."
        icon={<Icon.terminal w={22} />}
      />
    ) : (
      <Empty
        title="No connections yet"
        sub="Add a Postgres server from the sidebar to start querying."
        icon={<Icon.terminal w={22} />}
        action={<button className="btn btn-primary" onClick={onNew}><Icon.plus w={13} /> New connection</button>}
      />
    );
  }

  const csv = result
    ? [result.columns.join(","), ...result.rows.map((r) => r.map((c) => (c === null ? "" : `"${c.replace(/"/g, '""')}"`)).join(","))].join("\n")
    : "";

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%", minHeight: 0 }}>
      {/* editor */}
      <div className="glass-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* AI ask bar */}
        {ai.data?.available && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: asking ? "var(--accent)" : "var(--accent-2)", display: "flex", pointerEvents: "none" }}>
                {asking ? <Spinner size={14} /> : <Icon.sparkles w={15} />}
              </span>
              <input
                className="input"
                style={{ padding: "9px 12px 9px 34px", fontSize: 13 }}
                placeholder="Ask a question about your data — e.g. “top 10 customers by revenue this month”"
                value={question}
                disabled={asking}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ask(); } }}
              />
            </div>
            <button className="btn btn-primary" disabled={asking || !question.trim()} onClick={ask} style={{ background: "linear-gradient(135deg, var(--accent-3), var(--accent-2))" }}>
              {asking ? <Spinner size={13} /> : <Icon.sparkles w={14} />} Generate SQL
            </button>
            <span
              className="no-drag"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, flexShrink: 0 }}
              title="Run generated SQL immediately when it only reads — write queries always wait for review"
            >
              <button role="switch" aria-checked={autoRun} className={`switch ${autoRun ? "on" : ""}`} onClick={toggleAutoRun}>
                <span className="knob" />
              </button>
              <span style={{ fontSize: 11.5, color: autoRun ? "var(--text)" : "var(--muted)" }} onClick={toggleAutoRun}>
                Auto-run
              </span>
            </span>
          </div>
        )}

        {explanation && (
          <div className="fade" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 11, background: "rgba(56,217,196,0.1)", border: "1px solid rgba(56,217,196,0.25)", fontSize: 12.5, color: "var(--text)" }}>
            <span style={{ color: "var(--accent-2)", display: "flex", flexShrink: 0 }}><Icon.sparkles w={14} /></span>
            <span style={{ flex: 1 }}>{explanation}</span>
            <span style={{ display: "flex", cursor: "default", opacity: 0.6 }} onClick={() => setExplanation(null)}><Icon.close w={12} /></span>
          </div>
        )}

        <textarea
          ref={editorRef}
          className="textarea input"
          style={{ height: 132, fontSize: 13 }}
          placeholder={"SELECT * FROM users WHERE …\n\n⌘↩ to run"}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          spellCheck={false}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="btn btn-primary" disabled={running || !sql.trim()} onClick={() => runSql(sql)}>
            {running ? <Spinner size={13} /> : <Icon.play w={13} />} Run
            <span style={{ opacity: 0.6, fontSize: 11, fontWeight: 500 }}>⌘↩</span>
          </button>
          <button
            className="btn btn-sm"
            disabled={explaining || running || !sql.trim()}
            onClick={() => explain(false)}
            title="Show the planner's strategy without running the query"
          >
            {explaining ? <Spinner size={13} /> : <Icon.graph w={13} />} Explain
          </button>
          <button
            className="btn btn-sm"
            disabled={explaining || running || !sql.trim()}
            onClick={() => explain(true)}
            title="EXPLAIN ANALYZE — executes the query in a rolled-back transaction to capture real timings"
          >
            <Icon.zap w={13} /> Analyze
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowHistory(!showHistory)}>
            <Icon.history w={13} /> History {history.length > 0 && `(${history.length})`}
          </button>
          {connId && database && (
            <DatabasePicker connId={connId} database={database} onSwitch={(db) => onSwitchDatabase(connId, db)} style={{ width: 190 }} />
          )}
          <div style={{ flex: 1 }} />
          {result && (
            <>
              <span className="chip mono">{num(result.rows.length)} rows{result.truncated ? " (truncated)" : ""}</span>
              {result.affected !== null && result.rows.length === 0 && (
                <span className="chip mono">{num(result.affected)} affected</span>
              )}
              <span className="chip mono"><Icon.clock w={11} /> {elapsed(result.elapsed_ms)}</span>
              {result.rows.length > 0 && <CopyBtn text={csv} label="Copy CSV" />}
            </>
          )}
        </div>

        {showHistory && history.length > 0 && (
          <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto", borderTop: "1px solid var(--hair-soft)", paddingTop: 8 }}>
            {history.map((h, i) => (
              <div
                key={i}
                className="tbl-item mono"
                style={{ fontSize: 11.5 }}
                onClick={() => { setSql(h); setShowHistory(false); editorRef.current?.focus(); }}
              >
                <span className="nm">{h.replace(/\s+/g, " ")}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* results */}
      {error && (
        <div className="glass-card rise" style={{ padding: "13px 15px", color: "var(--error)", fontSize: 12.8, lineHeight: 1.5, border: "1px solid rgba(255,93,122,0.3)", fontFamily: "SF Mono, ui-monospace, monospace" }}>
          {error}
        </div>
      )}
      {plan && !error && (
        <PlanView json={plan.json} analyzed={plan.analyzed} sql={plan.sql} aiAvailable={!!ai.data?.available} />
      )}
      {result && result.columns.length > 0 && <DataGrid result={result} />}
      {result && result.columns.length === 0 && !error && (
        <div className="glass-card rise" style={{ padding: "13px 15px", color: "var(--ok)", fontSize: 13 }}>
          OK — {num(result.affected ?? 0)} row{(result.affected ?? 0) === 1 ? "" : "s"} affected · {elapsed(result.elapsed_ms)}
        </div>
      )}
      {!result && !plan && !error && (
        <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 13 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ opacity: 0.4, display: "flex", justifyContent: "center", marginBottom: 10 }}><Icon.terminal w={22} /></div>
            Results appear here — multiple statements are fine, separated by semicolons.
          </div>
        </div>
      )}
    </div>
  );
}
