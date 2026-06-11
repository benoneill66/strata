import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ColumnInfo, QueryResult } from "../lib/types";
import type { ChartConfig, ChartType, ShapedData } from "../lib/chart";
import { buildSeries, defaultConfig, fmtNum, fmtTime, fmtTimeFull, inferKinds, niceTicks, seriesColor } from "../lib/chart";
import { Icon } from "../lib/icons";

/** Chart mode for the results grid: a config toolbar plus hand-rolled SVG
    bar/line/pie/scatter renderers, styled to match the glass aesthetic. */

const TYPE_KEY = "strata.chart-type";
const TYPES: { id: ChartType; label: string }[] = [
  { id: "bar", label: "Bar" },
  { id: "line", label: "Line" },
  { id: "pie", label: "Pie" },
  { id: "scatter", label: "Scatter" },
];

function loadLastType(): ChartType {
  try {
    const t = localStorage.getItem(TYPE_KEY);
    if (t === "bar" || t === "line" || t === "pie" || t === "scatter") return t;
  } catch { /* ignore */ }
  return "bar";
}

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/* ---------- geometry ---------- */

interface Frame { w: number; h: number; l: number; r: number; t: number; b: number }
const frame = (w: number, h: number): Frame => ({ w, h, l: 52, r: 16, t: 12, b: 26 });

function yExtent(shaped: ShapedData, includeZero: boolean, pad: boolean): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const s of shaped.series)
    for (const v of s.values)
      if (v !== null) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
  if (!Number.isFinite(min)) return null;
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  if (pad) {
    const p = (max - min) * 0.06;
    min -= includeZero && min === 0 ? 0 : p;
    max += p;
  }
  return [min, max];
}

function linePath(xs: number[], ys: (number | null)[]): string {
  let d = "";
  let pen = false;
  ys.forEach((y, i) => {
    if (y === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${xs[i].toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  });
  return d;
}

function areaPath(xs: number[], ys: (number | null)[], y0: number): string {
  let d = "";
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    d += `M${xs[start].toFixed(1)},${y0.toFixed(1)}`;
    for (let i = start; i < end; i++) d += `L${xs[i].toFixed(1)},${(ys[i] as number).toFixed(1)}`;
    d += `L${xs[end - 1].toFixed(1)},${y0.toFixed(1)}Z`;
    start = -1;
  };
  ys.forEach((y, i) => {
    if (y === null) flush(i);
    else if (start < 0) start = i;
  });
  flush(ys.length);
  return d;
}

function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  if (a1 - a0 >= Math.PI * 2) a1 = a0 + Math.PI * 2 - 1e-4;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  if (r0 <= 0) return `M${cx},${cy} L${p(r1, a0)} A${r1},${r1} 0 ${large} 1 ${p(r1, a1)} Z`;
  return `M${p(r1, a0)} A${r1},${r1} 0 ${large} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

/* ---------- shared axes ---------- */

const GRID = "rgba(255,255,255,0.06)";
const TICK_STYLE: React.CSSProperties = { fill: "var(--muted)", fontSize: 10, fontFamily: '"SF Mono", ui-monospace, Menlo, monospace' };

function Axes({ f, yTicks, yPos, xTicks }: {
  f: Frame;
  yTicks: number[];
  yPos: (v: number) => number;
  xTicks: { x: number; label: string }[];
}) {
  return (
    <g>
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={f.l} x2={f.w - f.r} y1={yPos(v)} y2={yPos(v)} stroke={GRID} />
          <text x={f.l - 7} y={yPos(v) + 3} textAnchor="end" style={TICK_STYLE}>{fmtNum(v)}</text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text key={i} x={t.x} y={f.h - f.b + 16} textAnchor="middle" style={TICK_STYLE}>{t.label}</text>
      ))}
    </g>
  );
}

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Thin out band labels so they never collide. */
function bandTicks(labels: string[], f: Frame, slot: (i: number) => number): { x: number; label: string }[] {
  const fit = Math.max(1, Math.floor((f.w - f.l - f.r) / 76));
  const step = Math.ceil(labels.length / fit);
  return labels.filter((_, i) => i % step === 0).map((l, k) => ({ x: slot(k * step), label: trunc(l, 11) }));
}

function contTicks(min: number, max: number, axis: "time" | "linear", f: Frame, xPos: (v: number) => number): { x: number; label: string }[] {
  const n = Math.max(2, Math.floor((f.w - f.l - f.r) / 92));
  const all = niceTicks(min, max, n).map((v) => ({ x: xPos(v), label: axis === "time" ? fmtTime(v, max - min) : fmtNum(v) }));
  // time steps finer than the label granularity repeat ("Jun ’26 Jun ’26") — keep the first of each run
  return all.filter((t, i) => i === 0 || t.label !== all[i - 1].label);
}

type HoverFn = (i: number | null, e?: React.MouseEvent) => void;

/** Mouse position relative to the svg — offsetX is relative to whichever
    child element the cursor is over, so it can't be used here. */
function svgPos(e: React.MouseEvent<SVGGElement>): { mx: number; my: number } {
  const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
  return { mx: e.clientX - r.left, my: e.clientY - r.top };
}

/* ---------- renderers ---------- */

function BarChart({ shaped, f, gid, hover, onHover }: { shaped: ShapedData; f: Frame; gid: string; hover: number | null; onHover: HoverFn }) {
  const ext = yExtent(shaped, true, false);
  if (!ext) return null;
  const [y0v, y1v] = ext;
  const yPos = (v: number) => f.h - f.b - ((v - y0v) / (y1v - y0v)) * (f.h - f.t - f.b);
  const n = shaped.labels.length;
  const sw = (f.w - f.l - f.r) / Math.max(1, n);
  const group = sw * 0.72;
  const bw = Math.max(1, group / shaped.series.length);
  const base = yPos(0);

  return (
    <g
      onMouseMove={(e) => {
        const { mx } = svgPos(e);
        onHover(Math.max(0, Math.min(n - 1, Math.floor((mx - f.l) / sw))), e);
      }}
      onMouseLeave={() => onHover(null)}
    >
      <Axes f={f} yTicks={niceTicks(y0v, y1v)} yPos={yPos} xTicks={bandTicks(shaped.labels, f, (i) => f.l + sw * (i + 0.5))} />
      {hover !== null && hover < n && (
        <rect x={f.l + sw * hover} y={f.t} width={sw} height={f.h - f.t - f.b} fill="rgba(255,255,255,0.045)" />
      )}
      {shaped.series.map((s, k) =>
        s.values.map((v, i) => {
          if (v === null) return null;
          const y = yPos(v);
          return (
            <rect
              key={`${k}-${i}`}
              x={f.l + sw * i + (sw - group) / 2 + bw * k}
              y={Math.min(y, base)}
              width={Math.max(1, bw - 1.5)}
              height={Math.max(1, Math.abs(y - base))}
              rx={2}
              fill={`url(#${gid}-${k})`}
              stroke={`rgba(${s.color},${hover === i ? 0.95 : 0.5})`}
              strokeWidth={1}
            />
          );
        })
      )}
      <rect x={f.l} y={f.t} width={f.w - f.l - f.r} height={f.h - f.t - f.b} fill="transparent" />
    </g>
  );
}

function LineChart({ shaped, f, gid, area, hover, onHover }: { shaped: ShapedData; f: Frame; gid: string; area: boolean; hover: number | null; onHover: HoverFn }) {
  const ext = yExtent(shaped, area, !area);
  if (!ext) return null;
  const [y0v, y1v] = ext;
  const yPos = (v: number) => f.h - f.b - ((v - y0v) / (y1v - y0v)) * (f.h - f.t - f.b);
  const n = shaped.labels.length;

  const band = shaped.axis === "band";
  const sw = (f.w - f.l - f.r) / Math.max(1, n);
  let x0 = 0;
  let x1 = 1;
  if (!band) {
    x0 = Math.min(...shaped.xs);
    x1 = Math.max(...shaped.xs);
    if (x0 === x1) {
      x0 -= 1;
      x1 += 1;
    }
  }
  const xPos = (i: number) => (band ? f.l + sw * (i + 0.5) : f.l + ((shaped.xs[i] - x0) / (x1 - x0)) * (f.w - f.l - f.r));
  const xs = shaped.labels.map((_, i) => xPos(i));
  const baseline = yPos(Math.max(y0v, Math.min(y1v, 0)));

  return (
    <g
      onMouseMove={(e) => {
        const { mx } = svgPos(e);
        let best = 0;
        for (let i = 1; i < n; i++) if (Math.abs(xs[i] - mx) < Math.abs(xs[best] - mx)) best = i;
        onHover(n ? best : null, e);
      }}
      onMouseLeave={() => onHover(null)}
    >
      <Axes
        f={f}
        yTicks={niceTicks(y0v, y1v)}
        yPos={yPos}
        xTicks={band ? bandTicks(shaped.labels, f, (i) => f.l + sw * (i + 0.5)) : contTicks(x0, x1, shaped.axis === "time" ? "time" : "linear", f, (v) => f.l + ((v - x0) / (x1 - x0)) * (f.w - f.l - f.r))}
      />
      {shaped.series.map((s, k) => {
        const ys = s.values.map((v) => (v === null ? null : yPos(v)));
        return (
          <g key={k}>
            {area && <path d={areaPath(xs, ys, baseline)} fill={`url(#${gid}-${k})`} />}
            <path
              d={linePath(xs, ys)}
              fill="none"
              stroke={`rgb(${s.color})`}
              strokeWidth={2}
              strokeLinejoin="round"
              style={{ filter: `drop-shadow(0 0 5px rgba(${s.color},0.4))` }}
            />
          </g>
        );
      })}
      {hover !== null && hover < n && (
        <g>
          <line x1={xs[hover]} x2={xs[hover]} y1={f.t} y2={f.h - f.b} stroke="rgba(255,255,255,0.16)" />
          {shaped.series.map((s, k) =>
            s.values[hover] === null ? null : (
              <circle key={k} cx={xs[hover]} cy={yPos(s.values[hover]!)} r={3.6} fill={`rgb(${s.color})`} stroke="rgba(10,13,19,0.9)" strokeWidth={1.5} />
            )
          )}
        </g>
      )}
      <rect x={f.l} y={f.t} width={f.w - f.l - f.r} height={f.h - f.t - f.b} fill="transparent" />
    </g>
  );
}

function ScatterChart({ shaped, f, hover, onHover }: { shaped: ShapedData; f: Frame; hover: number | null; onHover: HoverFn }) {
  const ext = yExtent(shaped, false, true);
  if (!ext) return null;
  const [y0v, y1v] = ext;
  const yPos = (v: number) => f.h - f.b - ((v - y0v) / (y1v - y0v)) * (f.h - f.t - f.b);
  const n = shaped.labels.length;

  const band = shaped.axis === "band";
  const sw = (f.w - f.l - f.r) / Math.max(1, n);
  let x0 = 0;
  let x1 = 1;
  if (!band) {
    x0 = Math.min(...shaped.xs);
    x1 = Math.max(...shaped.xs);
    if (x0 === x1) {
      x0 -= 1;
      x1 += 1;
    }
    const p = (x1 - x0) * 0.04;
    x0 -= p;
    x1 += p;
  }
  const xPos = (i: number) => (band ? f.l + sw * (i + 0.5) : f.l + ((shaped.xs[i] - x0) / (x1 - x0)) * (f.w - f.l - f.r));

  return (
    <g
      onMouseMove={(e) => {
        const { mx, my } = svgPos(e);
        let best: number | null = null;
        let bd = 24 * 24;
        for (let i = 0; i < n; i++) {
          for (const s of shaped.series) {
            if (s.values[i] === null) continue;
            const dx = xPos(i) - mx;
            const dy = yPos(s.values[i]!) - my;
            const d = dx * dx + dy * dy;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
        }
        onHover(best, e);
      }}
      onMouseLeave={() => onHover(null)}
    >
      <Axes
        f={f}
        yTicks={niceTicks(y0v, y1v)}
        yPos={yPos}
        xTicks={band ? bandTicks(shaped.labels, f, (i) => f.l + sw * (i + 0.5)) : contTicks(x0, x1, shaped.axis === "time" ? "time" : "linear", f, (v) => f.l + ((v - x0) / (x1 - x0)) * (f.w - f.l - f.r))}
      />
      {shaped.series.map((s, k) => (
        <g key={k}>
          {s.values.map((v, i) =>
            v === null ? null : (
              <circle
                key={i}
                cx={xPos(i)}
                cy={yPos(v)}
                r={hover === i ? 5 : 3.2}
                fill={`rgba(${s.color},${hover === i ? 0.9 : 0.45})`}
                stroke={`rgb(${s.color})`}
                strokeWidth={1}
              />
            )
          )}
        </g>
      ))}
      <rect x={f.l} y={f.t} width={f.w - f.l - f.r} height={f.h - f.t - f.b} fill="transparent" />
    </g>
  );
}

function PieChart({ shaped, w, h, donut, hover, onHover }: { shaped: ShapedData; w: number; h: number; donut: boolean; hover: number | null; onHover: HoverFn }) {
  const values = shaped.series[0].values.map((v) => Math.max(0, v ?? 0));
  const total = values.reduce((t, v) => t + v, 0);
  if (total <= 0) return null;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) / 2 - 18;
  const r0 = donut ? R * 0.58 : 0;

  let a = -Math.PI / 2;
  const slices = values.map((v, i) => {
    const a0 = a;
    a += (v / total) * Math.PI * 2;
    return { i, a0, a1: a, mid: (a0 + a) / 2, v };
  });

  return (
    <g onMouseLeave={() => onHover(null)}>
      {slices.map((s) => {
        if (s.v <= 0) return null;
        const lift = hover === s.i ? 5 : 0;
        const color = seriesColor(s.i);
        return (
          <path
            key={s.i}
            d={arcPath(cx + Math.cos(s.mid) * lift, cy + Math.sin(s.mid) * lift, r0, R, s.a0, s.a1)}
            fill={`rgba(${color},${hover === s.i ? 0.92 : 0.62})`}
            stroke="rgba(10,13,19,0.85)"
            strokeWidth={1.5}
            onMouseMove={(e) => onHover(s.i, e)}
          />
        );
      })}
      {donut && (
        <text x={cx} y={cy + 4} textAnchor="middle" style={{ ...TICK_STYLE, fontSize: 13, fill: "var(--text)", fontWeight: 600 }}>
          {fmtNum(total)}
        </text>
      )}
    </g>
  );
}

/* ---------- panel ---------- */

export function ChartPanel({ result, hints, config, onConfig, caption }: {
  result: QueryResult;
  hints?: ColumnInfo[];
  config: ChartConfig | null;
  onConfig: (c: ChartConfig) => void;
  caption?: string;
}) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const bodyRef = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(bodyRef);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  const kinds = useMemo(() => inferKinds(result, hints), [result, hints]);
  const pk = useMemo(() => (hints ? new Set(hints.filter((c) => c.is_pk).map((c) => c.name)) : undefined), [hints]);
  const numCols = result.columns.filter((_, i) => kinds[i] === "numeric");

  // Non-destructive reconciliation: an absent or stale config (columns gone
  // after a new query) renders as fresh defaults; onConfig only fires on
  // user interaction.
  const cfg = useMemo(() => {
    const valid =
      config &&
      config.x !== null &&
      result.columns.includes(config.x) &&
      config.ys.length > 0 &&
      config.ys.every((y) => result.columns.includes(y));
    return valid ? config! : defaultConfig(result.columns, kinds, config?.type ?? loadLastType(), pk);
  }, [config, result, kinds, pk]);

  const shaped = useMemo(() => buildSeries(result, cfg, kinds), [result, cfg, kinds]);

  function update(patch: Partial<ChartConfig>) {
    if (patch.type) {
      try {
        localStorage.setItem(TYPE_KEY, patch.type);
      } catch { /* ignore */ }
    }
    setHover(null);
    onConfig({ ...cfg, ...patch });
  }

  function setType(t: ChartType) {
    // scatter wants a numeric/temporal x — re-default if the current pick is categorical
    if (t === "scatter" && cfg.x && kinds[result.columns.indexOf(cfg.x)] === "categorical") {
      const d = defaultConfig(result.columns, kinds, t, pk);
      update({ type: t, x: d.x ?? cfg.x });
      return;
    }
    update({ type: t });
  }

  function handleHover(i: number | null, e?: React.MouseEvent) {
    if (i === null || !e || !bodyRef.current) {
      setHover(null);
      return;
    }
    const r = bodyRef.current.getBoundingClientRect();
    setHover({ i, x: e.clientX - r.left, y: e.clientY - r.top });
  }

  const multiSeries = cfg.type !== "pie";
  const addable = numCols.filter((c) => c !== cfg.x && !cfg.ys.includes(c));
  const f = frame(w, h);

  const pieTotal = cfg.type === "pie" && shaped ? shaped.series[0].values.reduce<number>((t, v) => t + Math.max(0, v ?? 0), 0) : 1;
  const empty =
    cfg.ys.length === 0
      ? "Nothing to chart — no numeric columns. Cast values in SQL to chart them."
      : !shaped || shaped.labels.length === 0
        ? "No plottable rows — values didn't parse as numbers."
        : cfg.type === "pie" && pieTotal <= 0
          ? "Pie needs positive values."
          : null;

  const tooltip = hover && shaped && !empty ? (() => {
    if (cfg.type === "pie") {
      const v = Math.max(0, shaped.series[0].values[hover.i] ?? 0);
      return {
        title: shaped.labels[hover.i],
        rows: [{ color: seriesColor(hover.i), name: shaped.series[0].name, value: `${fmtNum(v)} · ${((v / pieTotal) * 100).toFixed(1)}%` }],
      };
    }
    return {
      title:
        shaped.axis === "time" ? fmtTimeFull(shaped.xs[hover.i]) : shaped.axis === "linear" ? fmtNum(shaped.xs[hover.i]) : shaped.labels[hover.i],
      rows: shaped.series
        .filter((s) => s.values[hover.i] !== null)
        .map((s) => ({ color: s.color, name: s.name, value: fmtNum(s.values[hover.i]!) })),
    };
  })() : null;

  return (
    <div className="chart-wrap no-drag fade">
      <div className="chart-toolbar">
        <div className="seg">
          {TYPES.map((t) => (
            <button key={t.id} className={cfg.type === t.id ? "on" : ""} onClick={() => setType(t.id)}>{t.label}</button>
          ))}
        </div>
        <span className="label">{cfg.type === "pie" ? "Slices" : "X"}</span>
        <select className="input" value={cfg.x ?? ""} onChange={(e) => update({ x: e.target.value })}>
          {result.columns.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className="label">{cfg.type === "pie" ? "Value" : "Y"}</span>
        <select
          className="input"
          value={cfg.ys[0] ?? ""}
          onChange={(e) => update({ ys: [e.target.value, ...cfg.ys.slice(1).filter((y) => y !== e.target.value)] })}
        >
          {numCols.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {multiSeries &&
          cfg.ys.slice(1).map((y) => (
            <span key={y} className="chip mono" style={{ gap: 5 }}>
              <span className="swatch" style={{ background: `rgb(${seriesColor(cfg.ys.indexOf(y))})` }} />
              {y}
              <span style={{ display: "flex", cursor: "default", opacity: 0.7 }} onClick={() => update({ ys: cfg.ys.filter((c) => c !== y) })}>
                <Icon.close w={10} />
              </span>
            </span>
          ))}
        {multiSeries && addable.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => update({ ys: [...cfg.ys, addable[0]] })}>
            <Icon.plus w={12} /> series
          </button>
        )}
        {cfg.type === "line" && (
          <label className="chart-opt">
            Area
            <button role="switch" aria-checked={cfg.area} className={`switch ${cfg.area ? "on" : ""}`} onClick={() => update({ area: !cfg.area })}>
              <span className="knob" />
            </button>
          </label>
        )}
        {cfg.type === "pie" && (
          <label className="chart-opt">
            Donut
            <button role="switch" aria-checked={cfg.donut} className={`switch ${cfg.donut ? "on" : ""}`} onClick={() => update({ donut: !cfg.donut })}>
              <span className="knob" />
            </button>
          </label>
        )}
        <div style={{ flex: 1 }} />
        {shaped && shaped.dropped > 0 && (
          <span className="chart-note">top {shaped.labels.length} of {shaped.labels.length + shaped.dropped}</span>
        )}
        {caption && <span className="chart-note">{caption}</span>}
      </div>

      <div className="chart-body" ref={bodyRef}>
        {empty ? (
          <div className="chart-empty">{empty}</div>
        ) : (
          w > 0 && h > 0 && shaped && (
            <>
              <svg className="chart-svg" width={w} height={h}>
                <defs>
                  {shaped.series.map((s, k) => (
                    <linearGradient key={k} id={`${gid}-${k}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={`rgba(${s.color},0.5)`} />
                      <stop offset="100%" stopColor={`rgba(${s.color},0.06)`} />
                    </linearGradient>
                  ))}
                </defs>
                {cfg.type === "bar" && <BarChart shaped={shaped} f={f} gid={gid} hover={hover?.i ?? null} onHover={handleHover} />}
                {cfg.type === "line" && <LineChart shaped={shaped} f={f} gid={gid} area={cfg.area} hover={hover?.i ?? null} onHover={handleHover} />}
                {cfg.type === "scatter" && <ScatterChart shaped={shaped} f={f} hover={hover?.i ?? null} onHover={handleHover} />}
                {cfg.type === "pie" && <PieChart shaped={shaped} w={w} h={h} donut={cfg.donut} hover={hover?.i ?? null} onHover={handleHover} />}
              </svg>

              {(shaped.series.length > 1 || cfg.type === "pie") && (
                <div className="chart-legend" style={{ flexDirection: cfg.type === "pie" ? "column" : "row" }}>
                  {cfg.type === "pie"
                    ? shaped.labels.map((l, i) => (
                        <span key={i} className="chip mono">
                          <span className="swatch" style={{ background: `rgb(${seriesColor(i)})` }} />
                          {trunc(l, 18)}
                        </span>
                      ))
                    : shaped.series.map((s) => (
                        <span key={s.name} className="chip mono">
                          <span className="swatch" style={{ background: `rgb(${s.color})` }} />
                          {s.name}
                        </span>
                      ))}
                </div>
              )}

              {tooltip && hover && (
                <div
                  className="chart-tooltip"
                  style={{
                    left: hover.x + (hover.x > w * 0.62 ? -14 : 14),
                    top: Math.min(hover.y + 14, h - 30),
                    transform: hover.x > w * 0.62 ? "translateX(-100%)" : undefined,
                  }}
                >
                  <div className="chart-tooltip-title">{trunc(tooltip.title, 38)}</div>
                  {tooltip.rows.map((r) => (
                    <div key={r.name} className="chart-tooltip-row mono">
                      <span className="swatch" style={{ background: `rgb(${r.color})` }} />
                      <span style={{ color: "var(--muted)" }}>{r.name}</span>
                      <span style={{ marginLeft: "auto", paddingLeft: 12 }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}
