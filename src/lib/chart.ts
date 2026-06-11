import type { ColumnInfo, QueryResult } from "./types";

/** Chart data shaping for results that arrive as text (simple-query protocol):
    column kinds are inferred by parsing values, with declared pg types as
    hints when Browse has them. */

export type ColKind = "numeric" | "temporal" | "categorical";
export type ChartType = "bar" | "line" | "pie" | "scatter";

export interface ChartConfig {
  type: ChartType;
  x: string | null;
  ys: string[]; // numeric series; pie uses ys[0]
  area: boolean; // line → filled area
  donut: boolean; // pie → donut
}

/** Accent palette as rgb triplets (PlanView heat() style) so renderers can
    derive both solid strokes and translucent glass fills. */
export const SERIES_COLORS = [
  "79,168,255", // --accent
  "56,217,196", // --accent-2
  "139,124,255", // --accent-3
  "255,180,84", // --alert
  "255,93,122", // --error
  "54,215,255", // --running
];

export function seriesColor(i: number): string {
  return SERIES_COLORS[i % SERIES_COLORS.length];
}

export function parseNum(s: string | null): number | null {
  if (s === null) return null;
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Parse a Postgres date/timestamp text value to epoch ms. WKWebView's
    Date.parse rejects the space separator and short tz offsets Postgres
    emits ("2026-06-11 10:00:00+00"), so normalize to strict ISO first. */
export function parseTemporal(s: string | null): number | null {
  if (s === null) return null;
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return null;
  let iso = t.replace(" ", "T");
  // expand short tz offsets only after a clock time — a bare date also ends in -\d\d
  if (/\d{2}:\d{2}/.test(iso)) iso = iso.replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function kindFromPgType(t: string): ColKind {
  const s = t.toLowerCase();
  if (/^(smallint|integer|bigint|numeric|decimal|real|double precision|float\d*|int\d*|oid|serial)/.test(s)) return "numeric";
  // plain time-of-day values have no date and won't parse — leave categorical
  if (/^(date|timestamp)/.test(s)) return "temporal";
  return "categorical";
}

const SAMPLE = 200;

export function inferKinds(result: QueryResult, hints?: ColumnInfo[]): ColKind[] {
  return result.columns.map((name, c) => {
    const hint = hints?.find((h) => h.name === name);
    if (hint) return kindFromPgType(hint.data_type);
    let seen = 0;
    let nums = 0;
    let times = 0;
    for (let r = 0; r < result.rows.length && seen < SAMPLE; r++) {
      const v = result.rows[r][c];
      if (v === null || v.trim() === "") continue;
      seen++;
      if (parseNum(v) !== null) nums++;
      else if (parseTemporal(v) !== null) times++;
    }
    if (seen === 0) return "categorical";
    if (nums / seen >= 0.9) return "numeric";
    if (times / seen >= 0.9) return "temporal";
    return "categorical";
  });
}

/** Sensible first config for a fresh result: X is the first temporal column,
    else categorical, else numeric (scatter wants numeric); Y is the first
    other numeric column, preferring non-PK so ids aren't charted. */
export function defaultConfig(columns: string[], kinds: ColKind[], type: ChartType, pk?: Set<string>): ChartConfig {
  const of = (k: ColKind) => columns.map((_, i) => i).filter((i) => kinds[i] === k);
  const nums = of("numeric");
  const x = type === "scatter" ? nums[0] : of("temporal")[0] ?? of("categorical")[0] ?? nums[0];
  const yc = nums.filter((i) => i !== x);
  const y = yc.find((i) => !pk?.has(columns[i])) ?? yc[0];
  return {
    type,
    x: x === undefined ? null : columns[x],
    ys: y === undefined ? [] : [columns[y]],
    area: false,
    donut: false,
  };
}

export interface ShapedData {
  /** band: discrete category slots; linear/time: continuous numeric x. */
  axis: "band" | "linear" | "time";
  labels: string[]; // raw x text per slot (tooltips, band ticks)
  xs: number[]; // parsed x per slot (linear/time only)
  series: { name: string; color: string; values: (number | null)[] }[];
  dropped: number; // categories hidden by the top-N cap
}

const BAR_CAP = 40;
const PIE_CAP = 8;

/** Group rows by raw x text, summing each y — so both pre-aggregated
    GROUP BY results and raw row dumps chart sensibly. */
function groupRows(result: QueryResult, xi: number, yis: number[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const row of result.rows) {
    const xv = row[xi];
    if (xv === null) continue;
    let g = groups.get(xv);
    if (!g) {
      g = new Array(yis.length).fill(0);
      groups.set(xv, g);
    }
    yis.forEach((yi, k) => {
      const n = parseNum(row[yi]);
      if (n !== null) g![k] += n;
    });
  }
  return groups;
}

export function buildSeries(result: QueryResult, cfg: ChartConfig, kinds: ColKind[]): ShapedData | null {
  const xi = cfg.x === null ? -1 : result.columns.indexOf(cfg.x);
  const yis = cfg.ys.map((y) => result.columns.indexOf(y)).filter((i) => i >= 0);
  if (xi < 0 || yis.length === 0) return null;
  const xKind = kinds[xi];
  const mk = (values: (number | null)[][]) =>
    yis.map((yi, k) => ({ name: result.columns[yi], color: seriesColor(k), values: values[k] }));

  if (cfg.type === "bar" || cfg.type === "pie") {
    const groups = groupRows(result, xi, yis);
    let entries = [...groups.entries()];
    if (xKind === "temporal") entries.sort((a, b) => (parseTemporal(a[0]) ?? 0) - (parseTemporal(b[0]) ?? 0));
    else if (xKind === "numeric") entries.sort((a, b) => (parseNum(a[0]) ?? 0) - (parseNum(b[0]) ?? 0));
    else entries.sort((a, b) => Math.abs(b[1][0]) - Math.abs(a[1][0]));

    let dropped = 0;
    if (cfg.type === "pie") {
      entries.sort((a, b) => b[1][0] - a[1][0]);
      if (entries.length > PIE_CAP) {
        const rest = entries.slice(PIE_CAP - 1);
        dropped = rest.length;
        const other = rest.reduce((t, [, g]) => t + g[0], 0);
        const otherEntry: [string, number[]] = ["Other", [other, ...new Array(yis.length - 1).fill(0)]];
        entries = [...entries.slice(0, PIE_CAP - 1), otherEntry];
      }
    } else if (xKind === "categorical" && entries.length > BAR_CAP) {
      // capping ordered (time/numeric) bars would scramble the axis — categorical only
      dropped = entries.length - BAR_CAP;
      entries = entries.slice(0, BAR_CAP);
    }

    return {
      axis: "band",
      labels: entries.map(([l]) => l),
      xs: [],
      series: mk(yis.map((_, k) => entries.map(([, g]) => g[k]))),
      dropped,
    };
  }

  // line / scatter: per-row points on a continuous axis when x parses
  const continuous = xKind === "temporal" || xKind === "numeric";
  const pts: { x: number; label: string; ys: (number | null)[] }[] = [];
  result.rows.forEach((row, r) => {
    const raw = row[xi];
    if (raw === null) return;
    const xv = continuous ? (xKind === "temporal" ? parseTemporal(raw) : parseNum(raw)) : r;
    if (xv === null) return;
    const ys = yis.map((yi) => parseNum(row[yi]));
    if (ys.every((v) => v === null)) return;
    pts.push({ x: xv, label: raw, ys });
  });
  if (cfg.type === "line" && continuous) pts.sort((a, b) => a.x - b.x);

  return {
    axis: continuous ? (xKind === "temporal" ? "time" : "linear") : "band",
    labels: pts.map((p) => p.label),
    xs: pts.map((p) => p.x),
    series: mk(yis.map((_, k) => pts.map((p) => p.ys[k]))),
    dropped: 0,
  };
}

/** Round tick positions with 1-2-5 stepping. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let i = Math.ceil(min / step); i * step <= max + step * 1e-6; i++) ticks.push(i * step);
  return ticks;
}

/** Compact value formatting for axes/tooltips, like estRows in format.ts. */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a < 1e10 ? 1 : 0)}b`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a < 1e7 ? 1 : 0)}m`;
  if (a >= 10_000) return `${(n / 1e3).toFixed(0)}k`;
  if (a >= 1000) return `${(n / 1e3).toFixed(1)}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(a < 10 ? 2 : 1);
}

const DAY = 86_400_000;

/** Span-aware time tick label: years across years, "11 Jun" across days,
    clock time within a day. */
export function fmtTime(t: number, spanMs: number): string {
  const d = new Date(t);
  if (spanMs >= 2 * 365 * DAY) return String(d.getFullYear());
  if (spanMs >= 60 * DAY) return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }).replace(" ", " ’");
  if (spanMs >= 2 * DAY) return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Full timestamp for tooltips. */
export function fmtTimeFull(t: number): string {
  const d = new Date(t);
  const hasClock = d.getHours() + d.getMinutes() + d.getSeconds() > 0;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + (hasClock ? ` ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "");
}
