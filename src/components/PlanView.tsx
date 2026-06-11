import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { num } from "../lib/format";
import { Icon } from "../lib/icons";
import { Spinner } from "./ui";

/** EXPLAIN visualizer: the plan JSON rendered as an indented tree of nodes,
    each with a flame-style self-time bar (self-cost when not analyzed), row
    estimate accuracy, and expandable raw details. */

interface PNode {
  Plans?: PNode[];
  [k: string]: unknown;
}

const nn = (v: unknown): number => (typeof v === "number" ? v : 0);
const ss = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Inclusive metric: wall time (× loops) when analyzed, planner cost otherwise. */
function inclusive(node: PNode, analyzed: boolean): number {
  return analyzed
    ? nn(node["Actual Total Time"]) * Math.max(1, nn(node["Actual Loops"]))
    : nn(node["Total Cost"]);
}

/** What this node spent itself, excluding its children. Clamped — parallel
    workers and CTE accounting can make children sum past the parent. */
function selfMetric(node: PNode, analyzed: boolean): number {
  const kids = (node.Plans ?? []).reduce((t, c) => t + inclusive(c, analyzed), 0);
  return Math.max(0, inclusive(node, analyzed) - kids);
}

function fmtMs(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  if (v >= 10) return `${v.toFixed(0)} ms`;
  return `${v.toFixed(2)} ms`;
}

/** Bar color by share of total: cool when cheap, hot when dominant. */
function heat(share: number): string {
  if (share >= 0.5) return "255,93,122";
  if (share >= 0.25) return "255,193,94";
  if (share >= 0.08) return "79,168,255";
  return "56,217,196";
}

function target(node: PNode): string | null {
  const rel = ss(node["Relation Name"]);
  const idx = ss(node["Index Name"]);
  if (rel && idx) return `${rel} · ${idx}`;
  if (rel) return rel;
  if (idx) return idx;
  const cte = ss(node["CTE Name"]);
  if (cte) return `CTE ${cte}`;
  const fun = ss(node["Function Name"]);
  if (fun) return `${fun}()`;
  return null;
}

/** The one condition/key line worth showing inline under the node title. */
const DETAIL_KEYS = ["Index Cond", "Recheck Cond", "Hash Cond", "Merge Cond", "Join Filter", "Filter", "Sort Key", "Group Key"];

function detailLine(node: PNode): string | null {
  for (const k of DETAIL_KEYS) {
    const v = node[k];
    if (typeof v === "string") return `${k}: ${v}`;
    if (Array.isArray(v)) return `${k}: ${v.join(", ")}`;
  }
  return null;
}

function renderVal(v: unknown): string | null {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v.join(", ");
  return null;
}

function NodeRow({
  node,
  depth,
  total,
  analyzed,
}: {
  node: PNode;
  depth: number;
  total: number;
  analyzed: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const kids = node.Plans ?? [];
  const self = selfMetric(node, analyzed);
  const share = total > 0 ? self / total : 0;
  const color = heat(share);
  const loops = Math.max(1, nn(node["Actual Loops"]));
  const neverRan = analyzed && nn(node["Actual Loops"]) === 0;
  const planRows = nn(node["Plan Rows"]);
  const actRows = nn(node["Actual Rows"]);
  // per-loop estimate accuracy; ≥10× off is worth flagging
  const factor = analyzed && !neverRan ? (Math.max(planRows, actRows) + 1) / (Math.min(planRows, actRows) + 1) : 1;
  const detail = detailLine(node);
  const tgt = target(node);
  const diskSort = ss(node["Sort Space Type"]) === "Disk";

  return (
    <>
      <div
        className="plan-row"
        style={{ paddingLeft: depth * 18 + 8, opacity: neverRan ? 0.45 : 1 }}
        onClick={() => setShowAll(!showAll)}
      >
        <span className="plan-bar" style={{ width: `${Math.max(share * 100, 0.5)}%`, background: `linear-gradient(90deg, rgba(${color},0.28), rgba(${color},0.05))` }} />
        <span
          className="plan-chev"
          style={{ visibility: kids.length ? "visible" : "hidden", transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        >
          <Icon.chevDown w={11} />
        </span>
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1, flex: 1, position: "relative" }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
            <span style={{ fontWeight: 640, fontSize: 12.5, whiteSpace: "nowrap" }}>{ss(node["Node Type"]) ?? "?"}</span>
            {tgt && <span className="mono" style={{ fontSize: 11, color: "var(--accent-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tgt}</span>}
            {ss(node["Join Type"]) && ss(node["Join Type"]) !== "Inner" && (
              <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{ss(node["Join Type"])!.toLowerCase()}</span>
            )}
            {neverRan && <span style={{ fontSize: 10.5, color: "var(--muted)", fontStyle: "italic" }}>never executed</span>}
          </span>
          {detail && (
            <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {detail}
            </span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, position: "relative" }}>
          {diskSort && <span className="plan-badge warn">disk sort</span>}
          {factor >= 10 && <span className="plan-badge warn" title={`planner estimated ${num(planRows)} rows, got ${num(actRows)}`}>est ×{Math.round(factor)} off</span>}
          {loops > 1 && <span className="plan-badge">×{num(loops)} loops</span>}
          <span className="mono plan-metric" title={analyzed ? "rows returned (per loop × loops)" : "estimated rows"}>
            {analyzed ? `${num(Math.round(actRows * loops))} rows` : `~${num(planRows)} rows`}
          </span>
          <span className="mono plan-metric" style={{ color: `rgb(${color})`, minWidth: 86, textAlign: "right" }}>
            {analyzed ? fmtMs(self) : `cost ${num(Math.round(self))}`} · {(share * 100).toFixed(share >= 0.095 ? 0 : 1)}%
          </span>
        </span>
      </div>

      {showAll && (
        <div className="plan-detail mono" style={{ marginLeft: depth * 18 + 30 }}>
          {Object.entries(node)
            .filter(([k]) => k !== "Plans" && k !== "Node Type")
            .map(([k, v]) => {
              const r = renderVal(v);
              return r === null ? null : (
                <div key={k}>
                  <span style={{ color: "var(--muted)" }}>{k}: </span>
                  {r}
                </div>
              );
            })}
        </div>
      )}

      {open && kids.map((c, i) => <NodeRow key={i} node={c} depth={depth + 1} total={total} analyzed={analyzed} />)}
    </>
  );
}

export function PlanView({
  json,
  analyzed,
  sql,
  aiAvailable,
}: {
  json: string;
  analyzed: boolean;
  sql: string;
  aiAvailable: boolean;
}) {
  const [diag, setDiag] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  const parsed = useMemo(() => {
    try {
      const doc = JSON.parse(json)[0];
      if (!doc?.Plan) return null;
      return {
        root: doc.Plan as PNode,
        planning: nn(doc["Planning Time"]),
        execution: nn(doc["Execution Time"]),
      };
    } catch {
      return null;
    }
  }, [json]);

  async function diagnose() {
    if (diagnosing) return;
    setDiagnosing(true);
    try {
      setDiag(await api.diagnosePlan(sql, json));
    } catch (e) {
      setDiag(e instanceof Error ? e.message : String(e));
    } finally {
      setDiagnosing(false);
    }
  }

  if (!parsed) {
    return (
      <div className="glass-card rise" style={{ padding: "13px 15px", color: "var(--error)", fontSize: 12.8 }}>
        Could not parse the plan JSON.
      </div>
    );
  }

  const { root, planning, execution } = parsed;
  const total = analyzed ? (execution > 0 ? execution : inclusive(root, true)) : inclusive(root, false);

  return (
    <div className="fade" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="chip mono"><Icon.clock w={11} /> planning {fmtMs(planning)}</span>
        {analyzed ? (
          <span className="chip mono"><Icon.zap w={11} /> execution {fmtMs(execution)}</span>
        ) : (
          <>
            <span className="chip mono">total cost {num(Math.round(inclusive(root, false)))}</span>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>estimates only — Explain Analyze for real timings</span>
          </>
        )}
        <div style={{ flex: 1 }} />
        {aiAvailable && (
          <button className="btn btn-sm" onClick={diagnose} disabled={diagnosing}>
            {diagnosing ? <Spinner size={13} /> : <Icon.sparkles w={13} />} Diagnose
          </button>
        )}
      </div>

      {diag && (
        <div className="fade" style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 11, background: "rgba(56,217,196,0.1)", border: "1px solid rgba(56,217,196,0.25)", fontSize: 12.5, lineHeight: 1.5 }}>
          <span style={{ color: "var(--accent-2)", display: "flex", flexShrink: 0 }}><Icon.sparkles w={14} /></span>
          <span style={{ flex: 1 }}>{diag}</span>
          <span style={{ display: "flex", cursor: "default", opacity: 0.6, flexShrink: 0 }} onClick={() => setDiag(null)}><Icon.close w={12} /></span>
        </div>
      )}

      <div className="plan-wrap no-drag">
        <NodeRow node={root} depth={0} total={total} analyzed={analyzed} />
      </div>
    </div>
  );
}
