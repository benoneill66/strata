import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { estRows } from "../lib/format";
import { Icon } from "../lib/icons";
import { TABLE_KINDS } from "../lib/types";
import type { GraphColumn, GraphNode, SchemaGraph } from "../lib/types";
import { DatabasePicker } from "../components/DatabasePicker";
import { Empty, Spinner } from "../components/ui";

// Node geometry — must match the CSS in styles.css (.erd-node).
const NODE_W = 224;
const HEADER_H = 40;
const ROW_H = 21;
const PAD_B = 7;

type Density = "compact" | "keys" | "all";
type Pt = { x: number; y: number };
type Layout = Record<string, Pt>; // node centre coordinates

const keyCols = (n: GraphNode) => n.columns.filter((c) => c.is_pk || c.is_fk);

/** Which columns to render for a node, given the density mode and any per-node
    drill-down. "compact" shows none (just the header), "keys" shows PK/FK only
    (the relationship-relevant ones), "all" shows everything. */
function shownCols(n: GraphNode, d: Density, expanded: Set<string>): GraphColumn[] {
  if (expanded.has(n.name) || d === "all") return n.columns;
  if (d === "compact") return [];
  return keyCols(n);
}
function showsMore(n: GraphNode, d: Density, expanded: Set<string>): boolean {
  return d === "keys" && !expanded.has(n.name) && n.columns.length > keyCols(n).length;
}
function nodeH(n: GraphNode, d: Density, expanded: Set<string>): number {
  const body = shownCols(n, d, expanded).length + (showsMore(n, d, expanded) ? 1 : 0);
  return HEADER_H + (body ? body * ROW_H + PAD_B : 0);
}

const EMPTY = new Set<string>();
const layoutHeight = (n: GraphNode) => nodeH(n, "keys", EMPTY); // canonical size for layout

/** Force-directed layout (Fruchterman–Reingold) on a set of connected nodes,
    then a box-collision pass so cards never overlap. Positions are centres,
    recentred on the centroid. */
function forceLayout(nodes: GraphNode[], edges: SchemaGraph["edges"]): Pt[] {
  const n = nodes.length;
  const idx = new Map(nodes.map((d, i) => [d.name, i]));
  const size = nodes.map((d) => ({ w: NODE_W, h: layoutHeight(d) }));
  const k = Math.min(380, Math.max(210, 60 * Math.sqrt(n))); // spacing grows with size

  const pos: Pt[] = nodes.map((_, i) => {
    const a = (i / n) * Math.PI * 2;
    const r = k * Math.sqrt(n) * 0.42 + 1;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
  const links = edges
    .map((e) => [idx.get(e.source), idx.get(e.target)] as [number | undefined, number | undefined])
    .filter(([a, b]) => a != null && b != null && a !== b) as [number, number][];

  let temp = k * 0.9;
  for (let it = 0; it < 340; it++) {
    const disp: Pt[] = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const f = Math.min((k * k) / dist, 4 * k);
        dx /= dist; dy /= dist;
        disp[i].x += dx * f; disp[i].y += dy * f;
        disp[j].x -= dx * f; disp[j].y -= dy * f;
      }
    }
    for (const [a, b] of links) {
      let dx = pos[a].x - pos[b].x;
      let dy = pos[a].y - pos[b].y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const f = (dist * dist) / k;
      dx /= dist; dy /= dist;
      disp[a].x -= dx * f; disp[a].y -= dy * f;
      disp[b].x += dx * f; disp[b].y += dy * f;
    }
    for (let i = 0; i < n; i++) { disp[i].x -= pos[i].x * 0.11; disp[i].y -= pos[i].y * 0.11; }
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(disp[i].x, disp[i].y) || 0.01;
      pos[i].x += (disp[i].x / d) * Math.min(d, temp);
      pos[i].y += (disp[i].y / d) * Math.min(d, temp);
    }
    temp = Math.max(temp * 0.985, 4);
  }

  for (let pass = 0; pass < 90; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const minX = (size[i].w + size[j].w) / 2 + 34;
        const minY = (size[i].h + size[j].h) / 2 + 28;
        const ox = minX - Math.abs(dx);
        const oy = minY - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          moved = true;
          if (ox < oy) { const s = ((dx < 0 ? -1 : 1) * ox) / 2; pos[i].x += s; pos[j].x -= s; }
          else { const s = ((dy < 0 ? -1 : 1) * oy) / 2; pos[i].y += s; pos[j].y -= s; }
        }
      }
    }
    if (!moved) break;
  }

  let cx = 0, cy = 0;
  for (const p of pos) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  return pos.map((p) => ({ x: p.x - cx, y: p.y - cy }));
}

/** Lay out the schema: foreign-keyed tables get a force-directed graph, while
    orphan tables (no relationships) are parked in a tidy grid beneath it so a
    single disconnected table can't fling the whole map into a corner. */
function computeLayout(g: SchemaGraph): Layout {
  const nodes = g.nodes;
  if (!nodes.length) return {};
  const deg = new Map<string, number>();
  for (const e of g.edges) {
    if (e.source === e.target) continue;
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }
  const linked = nodes.filter((nd) => (deg.get(nd.name) ?? 0) > 0);
  const orphans = nodes.filter((nd) => (deg.get(nd.name) ?? 0) === 0);

  const out: Layout = {};
  let clusterMaxY = -Infinity, clusterCx = 0, clusterMinX = Infinity, clusterMaxX = -Infinity;
  if (linked.length) {
    const pos = forceLayout(linked, g.edges);
    linked.forEach((nd, i) => {
      out[nd.name] = pos[i];
      const h = layoutHeight(nd);
      clusterMaxY = Math.max(clusterMaxY, pos[i].y + h / 2);
      clusterMinX = Math.min(clusterMinX, pos[i].x - NODE_W / 2);
      clusterMaxX = Math.max(clusterMaxX, pos[i].x + NODE_W / 2);
    });
    clusterCx = (clusterMinX + clusterMaxX) / 2;
  }

  if (orphans.length) {
    const cellW = NODE_W + 46;
    const rowH = Math.max(...orphans.map(layoutHeight)) + 34;
    // fit grid width to the cluster (or a sensible default) so it sits under it
    const maxCols = linked.length
      ? Math.max(1, Math.round((clusterMaxX - clusterMinX) / cellW))
      : Math.ceil(Math.sqrt(orphans.length));
    const perRow = Math.max(1, Math.min(orphans.length, maxCols));
    const startY = (linked.length ? clusterMaxY + 80 : -(Math.ceil(orphans.length / perRow) * rowH) / 2);
    const totalW = perRow * cellW;
    const startX = (linked.length ? clusterCx : 0) - totalW / 2 + cellW / 2;
    orphans.forEach((nd, i) => {
      const r = Math.floor(i / perRow);
      const c = i % perRow;
      out[nd.name] = { x: startX + c * cellW, y: startY + r * rowH + rowH / 2 };
    });
  }

  // recentre everything on its centroid so the viewport fit is deterministic
  const names = Object.keys(out);
  let cx = 0, cy = 0;
  for (const nm of names) { cx += out[nm].x; cy += out[nm].y; }
  cx /= names.length; cy /= names.length;
  for (const nm of names) { out[nm] = { x: out[nm].x - cx, y: out[nm].y - cy }; }
  return out;
}

function colRowY(top: number, col: string, cols: GraphColumn[]): number {
  const i = cols.findIndex((c) => c.name === col);
  if (i < 0) return top + HEADER_H / 2; // header anchor (compact, or column hidden)
  return top + HEADER_H + (i + 0.5) * ROW_H;
}

export function Schema({
  connId,
  database,
  hasConnections,
  onNew,
  onSwitchDatabase,
}: {
  connId: string | null;
  database: string | null;
  hasConnections: boolean;
  onNew: () => void;
  onSwitchDatabase: (id: string, db: string) => Promise<void>;
}) {
  const [schema, setSchema] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [density, setDensity] = useState<Density>("keys");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const [layout, setLayout] = useState<Layout>({});
  const [view, setView] = useState({ x: 0, y: 0, z: 1 }); // pan + zoom

  const vpRef = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | { kind: "pan" | "node"; name?: string; sx: number; sy: number; ox: number; oy: number }
    | { kind: "zoom"; sy: number; mx: number; my: number; z0: number; vx0: number; vy0: number }
    | null
  >(null);
  const movedRef = useRef(false); // distinguishes a drag from a click (read by click handlers)
  const gRef = useRef<SchemaGraph | null>(null);
  const layRef = useRef<Layout>({});
  const viewRef = useRef(view);
  const densityRef = useRef(density);
  const expandedRef = useRef(expanded);
  const fittedRef = useRef(false);
  useEffect(() => { layRef.current = layout; }, [layout]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { densityRef.current = density; }, [density]);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);

  useEffect(() => { setSchema(null); }, [database]);

  const schemas = useAsync(() => (connId ? api.listSchemas(connId) : Promise.resolve([])), [connId, database]);
  useEffect(() => {
    if (!schema && schemas.data?.length) {
      const pub = schemas.data.find((s) => s.name === "public");
      setSchema((pub ?? schemas.data[0]).name);
    }
  }, [schemas.data, schema]);

  const graph = useAsync(
    () => (connId && schema ? api.schemaGraph(connId, schema) : Promise.resolve<SchemaGraph | null>(null)),
    [connId, schema, database]
  );

  const nodeByName = useMemo(() => {
    const m = new Map<string, GraphNode>();
    graph.data?.nodes.forEach((nd) => m.set(nd.name, nd));
    return m;
  }, [graph.data]);

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    graph.data?.edges.forEach((e) => {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    });
    return m;
  }, [graph.data]);

  // (re)compute layout whenever a new graph arrives; fit once it's on screen.
  useEffect(() => {
    if (!graph.data) return;
    gRef.current = graph.data;
    const lay = computeLayout(graph.data);
    layRef.current = lay;
    setLayout(lay);
    setSel(null);
    setExpanded(new Set());
    fittedRef.current = false;
    if (doFit()) fittedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.data]);

  // The viewport isn't rendered until a connection exists and the tab is shown,
  // so it can have zero size when the graph first loads. Re-attach the observer
  // once it exists (keyed on connId) and fit as soon as it gains size.
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!fittedRef.current && Object.keys(layRef.current).length && doFit()) fittedRef.current = true;
    });
    ro.observe(vp);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId]);

  /** Centre + scale the graph to fit the viewport. No-op (returns false) when
      the viewport has no size yet, so a bad transform is never committed. */
  function doFit(): boolean {
    const vp = vpRef.current;
    const g = gRef.current;
    const lay = layRef.current;
    if (!vp || !g || !g.nodes.length || vp.clientWidth < 2 || vp.clientHeight < 2) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const nd of g.nodes) {
      const p = lay[nd.name];
      if (!p) continue;
      const h = nodeH(nd, densityRef.current, expandedRef.current);
      minX = Math.min(minX, p.x - NODE_W / 2);
      maxX = Math.max(maxX, p.x + NODE_W / 2);
      minY = Math.min(minY, p.y - h / 2);
      maxY = Math.max(maxY, p.y + h / 2);
    }
    if (!isFinite(minX)) return false;
    const pad = 70;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    const z = Math.min(1, Math.max(0.12, Math.min(vp.clientWidth / w, vp.clientHeight / h)));
    setView({ z, x: vp.clientWidth / 2 - ((minX + maxX) / 2) * z, y: vp.clientHeight / 2 - ((minY + maxY) / 2) * z });
    return true;
  }

  function relayout() {
    const g = gRef.current;
    if (!g) return;
    const lay = computeLayout(g);
    layRef.current = lay;
    setLayout(lay);
    fittedRef.current = false;
    if (doFit()) fittedRef.current = true;
  }

  // ----- drag: pan background, move a node, or ⌘-drag to zoom -----
  // (stable handlers so the memoised node/edge subtree doesn't rebuild)
  const onMove = useCallback((e: MouseEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "zoom") {
      movedRef.current = true;
      const nz = Math.min(2, Math.max(0.12, d.z0 * Math.exp((d.sy - e.clientY) * 0.005)));
      setView({ z: nz, x: d.mx - ((d.mx - d.vx0) / d.z0) * nz, y: d.my - ((d.my - d.vy0) / d.z0) * nz });
      return;
    }
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;
    if (d.kind === "pan") {
      setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    } else if (d.name) {
      const z = viewRef.current.z;
      setLayout((l) => ({ ...l, [d.name!]: { x: d.ox + dx / z, y: d.oy + dy / z } }));
    }
  }, []);
  const onUp = useCallback(() => {
    drag.current = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }, [onMove]);
  const onPointerDown = useCallback((e: React.MouseEvent, name?: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    movedRef.current = false;
    const v = viewRef.current;
    // ⌘ + drag on the background = zoom (vertical), anchored at the cursor
    if (!name && (e.metaKey || e.altKey)) {
      const rect = vpRef.current!.getBoundingClientRect();
      drag.current = { kind: "zoom", sy: e.clientY, mx: e.clientX - rect.left, my: e.clientY - rect.top, z0: v.z, vx0: v.x, vy0: v.y };
    } else {
      const p = name ? layRef.current[name] : null;
      drag.current = { kind: name ? "node" : "pan", name, sx: e.clientX, sy: e.clientY, ox: name && p ? p.x : v.x, oy: name && p ? p.y : v.y };
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [onMove, onUp]);
  useEffect(() => () => onUp(), [onUp]);

  const toggleExpand = useCallback((name: string) => {
    setExpanded((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }, []);
  const clickNode = useCallback((name: string) => {
    if (movedRef.current) return; // a drag, not a click
    setSel((s) => (s === name ? null : name));
  }, []);

  // Trackpad gestures via non-passive native listeners (React's onWheel is
  // passive, so it can't preventDefault the WKWebView's own pinch-zoom and
  // two-finger back-swipe; pinch arrives as Safari gesture* events, not wheel).
  // Two-finger drag → pan · pinch → zoom · also ctrl+wheel → zoom (dev browser).
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const clamp = (z: number) => Math.min(2, Math.max(0.12, z));
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      if (e.ctrlKey) {
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const f = Math.min(1.6, Math.max(0.62, Math.exp(-e.deltaY * 0.01)));
        setView((v) => ({ z: clamp(v.z * f), x: mx - ((mx - v.x) / v.z) * clamp(v.z * f), y: my - ((my - v.y) / v.z) * clamp(v.z * f) }));
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    let gz = { z0: 1, mx: 0, my: 0, vx0: 0, vy0: 0 };
    const onGestureStart = (e: any) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const v = viewRef.current;
      gz = { z0: v.z, mx: e.clientX - rect.left, my: e.clientY - rect.top, vx0: v.x, vy0: v.y };
    };
    const onGestureChange = (e: any) => {
      e.preventDefault();
      const nz = clamp(gz.z0 * e.scale);
      setView({ z: nz, x: gz.mx - ((gz.mx - gz.vx0) / gz.z0) * nz, y: gz.my - ((gz.my - gz.vy0) / gz.z0) * nz });
    };
    const prevent = (e: Event) => e.preventDefault();
    vp.addEventListener("wheel", onWheel, { passive: false });
    vp.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
    vp.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
    vp.addEventListener("gestureend", prevent as EventListener, { passive: false });
    return () => {
      vp.removeEventListener("wheel", onWheel);
      vp.removeEventListener("gesturestart", onGestureStart as EventListener);
      vp.removeEventListener("gesturechange", onGestureChange as EventListener);
      vp.removeEventListener("gestureend", prevent as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId]);

  function focusNode(name: string) {
    const vp = vpRef.current;
    const p = layRef.current[name];
    if (!vp || !p) return;
    setSel(name);
    setView((v) => ({ ...v, x: vp.clientWidth / 2 - p.x * v.z, y: vp.clientHeight / 2 - p.y * v.z }));
  }

  function zoomBy(f: number) {
    const vp = vpRef.current;
    if (!vp) return;
    const mx = vp.clientWidth / 2, my = vp.clientHeight / 2;
    setView((v) => {
      const nz = Math.min(2, Math.max(0.12, v.z * f));
      return { z: nz, x: mx - ((mx - v.x) / v.z) * nz, y: my - ((my - v.y) / v.z) * nz };
    });
  }

  const g = graph.data;
  const active = hover ?? sel;
  const matches = useCallback(
    (name: string) => !!search && name.toLowerCase().includes(search.toLowerCase()),
    [search]
  );

  // Memoised so panning/zooming (which only changes `view`) never rebuilds the
  // node/edge subtree — that re-render of hundreds of cards was the lag.
  const edgesEl = useMemo(() => {
    if (!g) return null;
    return (
      <svg className="erd-edges" width="1" height="1" style={{ overflow: "visible" }}>
        <defs>
          <marker id="erd-dot" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5">
            <circle cx="3.5" cy="3.5" r="2.4" fill="var(--accent-2)" />
          </marker>
        </defs>
        {g.edges.map((e, i) => {
          const sp = layout[e.source];
          const tp = layout[e.target];
          const sNode = nodeByName.get(e.source);
          const tNode = nodeByName.get(e.target);
          if (!sp || !tp || !sNode || !tNode || e.source === e.target) return null;
          const sCols = shownCols(sNode, density, expanded);
          const tCols = shownCols(tNode, density, expanded);
          const sTop = sp.y - nodeH(sNode, density, expanded) / 2;
          const tTop = tp.y - nodeH(tNode, density, expanded) / 2;
          const dir = tp.x >= sp.x ? 1 : -1;
          const sx = sp.x + dir * (NODE_W / 2);
          const sy = colRowY(sTop, e.source_columns[0], sCols);
          const tx = tp.x - dir * (NODE_W / 2);
          const ty = colRowY(tTop, e.target_columns[0], tCols);
          const curve = Math.max(34, Math.abs(tx - sx) * 0.4);
          const on = !active || e.source === active || e.target === active;
          return (
            <path
              key={i}
              className={`erd-edge ${active && !on ? "dim" : ""} ${active && on ? "on" : ""}`}
              d={`M ${sx} ${sy} C ${sx + dir * curve} ${sy}, ${tx - dir * curve} ${ty}, ${tx} ${ty}`}
              markerEnd="url(#erd-dot)"
            />
          );
        })}
      </svg>
    );
  }, [g, layout, density, expanded, active, nodeByName]);

  const nodesEl = useMemo(() => {
    if (!g) return null;
    const lit = (name: string) => !active || name === active || neighbours.get(active)?.has(name) || false;
    return g.nodes.map((nd) => {
      const p = layout[nd.name];
      if (!p) return null;
      const cols = shownCols(nd, density, expanded);
      const more = showsMore(nd, density, expanded) ? nd.columns.length - keyCols(nd).length : 0;
      const h = nodeH(nd, density, expanded);
      const dim = !!active && !lit(nd.name);
      return (
        <div
          key={nd.name}
          className={`erd-node ${nd.name === sel ? "sel" : ""} ${dim ? "dim" : ""} ${matches(nd.name) ? "match" : ""}`}
          style={{ left: p.x - NODE_W / 2, top: p.y - h / 2, width: NODE_W }}
          onMouseEnter={() => setHover(nd.name)}
          onMouseLeave={() => setHover((hh) => (hh === nd.name ? null : hh))}
          onClick={(e) => { e.stopPropagation(); clickNode(nd.name); }}
          onMouseDown={(e) => onPointerDown(e, nd.name)}
        >
          <div className="erd-node-head" style={{ height: HEADER_H }}>
            <span style={{ display: "flex", opacity: 0.8 }}>
              {nd.kind === "v" || nd.kind === "m" ? <Icon.eye w={12} /> : <Icon.table w={12} />}
            </span>
            <span className="nm mono">{nd.name}</span>
            <span className="erd-kind">{nd.est_rows >= 0 ? estRows(nd.est_rows) : (TABLE_KINDS[nd.kind] ?? nd.kind)}</span>
          </div>
          {cols.length > 0 && (
            <div>
              {cols.map((c) => (
                <div key={c.name} className="erd-col" style={{ height: ROW_H }}>
                  <span className="erd-col-ic">
                    {c.is_pk ? <span style={{ color: "var(--accent)" }}><Icon.key w={10} /></span>
                      : c.is_fk ? <span style={{ color: "var(--accent-2)" }}><Icon.link w={10} /></span>
                      : <span className="erd-dot-col" />}
                  </span>
                  <span className={`erd-col-nm ${c.is_pk ? "pk" : ""}`}>{c.name}</span>
                  <span className="erd-col-ty mono">{c.data_type}</span>
                </div>
              ))}
            </div>
          )}
          {more > 0 && (
            <div
              className="erd-col erd-more"
              style={{ height: ROW_H }}
              onClick={(e) => { e.stopPropagation(); toggleExpand(nd.name); }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              + {more} more {more === 1 ? "column" : "columns"}
            </div>
          )}
        </div>
      );
    });
  }, [g, layout, density, expanded, active, sel, matches, neighbours, clickNode, toggleExpand, onPointerDown]);

  if (!connId) {
    return hasConnections ? (
      <Empty title="Choose a connection" sub="Pick a server on the left to connect, then explore how its tables link together." icon={<Icon.graph w={22} />} />
    ) : (
      <Empty
        title="No connections yet"
        sub="Add a Postgres server to map its schema and foreign-key relationships."
        icon={<Icon.graph w={22} />}
        action={<button className="btn btn-primary" onClick={onNew}><Icon.plus w={13} /> New connection</button>}
      />
    );
  }

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
      {/* ---------- toolbar ---------- */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {database && (
          <div style={{ width: 158 }}>
            <DatabasePicker connId={connId} database={database} onSwitch={(db) => onSwitchDatabase(connId, db)} />
          </div>
        )}
        <select
          className="input no-drag"
          style={{ width: 140, padding: "8px 10px", fontSize: 13 }}
          value={schema ?? ""}
          onChange={(e) => { setSchema(e.target.value); setSearch(""); }}
        >
          {(schemas.data ?? []).map((s) => (
            <option key={s.name} value={s.name}>{s.name} ({s.tables})</option>
          ))}
        </select>

        <div style={{ position: "relative", width: 180 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", display: "flex" }}>
            <Icon.search w={13} />
          </span>
          <input
            className="input no-drag"
            style={{ padding: "8px 10px 8px 30px", fontSize: 12.5 }}
            placeholder="Find a table…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && g) { const hit = g.nodes.find((nd) => matches(nd.name)); if (hit) focusNode(hit.name); } }}
          />
        </div>

        {g && (
          <span className="chip mono" title="tables · relationships">{g.nodes.length} tables · {g.edges.length} links</span>
        )}

        <div style={{ flex: 1 }} />

        <div className="seg no-drag" title="Column detail">
          <button className={density === "compact" ? "on" : ""} onClick={() => setDensity("compact")}>Tables</button>
          <button className={density === "keys" ? "on" : ""} onClick={() => setDensity("keys")}>Keys</button>
          <button className={density === "all" ? "on" : ""} onClick={() => setDensity("all")}>All</button>
        </div>
        <div className="seg no-drag">
          <button onClick={() => zoomBy(0.83)} title="Zoom out"><Icon.minus w={13} /></button>
          <button onClick={() => zoomBy(1.2)} title="Zoom in"><Icon.plus w={13} /></button>
        </div>
        <button className="btn btn-sm no-drag" onClick={() => doFit()} title="Fit to view"><Icon.frame w={13} /> Fit</button>
        <button className="btn btn-sm no-drag" onClick={relayout} title="Re-arrange"><Icon.refresh w={13} /></button>
      </div>

      {/* ---------- canvas ---------- */}
      <div
        ref={vpRef}
        className="erd-viewport no-drag"
        onMouseDown={(e) => onPointerDown(e)}
        onClick={() => { if (!movedRef.current) setSel(null); }}
      >
        {graph.loading && graph.initial && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}><Spinner size={22} /></div>
        )}
        {graph.error && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--error)", fontSize: 13 }}>{graph.error}</div>
        )}
        {g && !graph.loading && g.nodes.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <Empty title="Empty schema" sub="This schema has no tables to map." icon={<Icon.graph w={22} />} />
          </div>
        )}

        {g && Object.keys(layout).length > 0 && (
          <div className="erd-canvas" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
            {edgesEl}
            {nodesEl}
          </div>
        )}

        {g && g.nodes.length > 0 && (
          <div className="erd-legend mono">
            <span><span style={{ color: "var(--accent)" }}><Icon.key w={10} /></span> primary key</span>
            <span><span style={{ color: "var(--accent-2)" }}><Icon.link w={10} /></span> foreign key</span>
            <span className="erd-hint">two-finger drag to pan · pinch or ⌘-drag to zoom</span>
          </div>
        )}
      </div>
    </div>
  );
}
