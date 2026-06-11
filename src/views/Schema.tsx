import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { estRows } from "../lib/format";
import { Icon } from "../lib/icons";
import { TABLE_KINDS } from "../lib/types";
import type { GraphNode, SchemaGraph } from "../lib/types";
import { DatabasePicker } from "../components/DatabasePicker";
import { Empty, Spinner } from "../components/ui";

// Node geometry — must match the CSS in styles.css (.erd-node).
const NODE_W = 224;
const HEADER_H = 36;
const ROW_H = 22;
const PAD_B = 8;
const nodeH = (n: GraphNode) => HEADER_H + n.columns.length * ROW_H + PAD_B;

type Pt = { x: number; y: number };
type Layout = Record<string, Pt>; // node centre coordinates

/** Deterministic force-directed layout (Fruchterman–Reingold) followed by a
    box-collision pass so cards never overlap. Runs once per graph; nodes are
    draggable afterwards. Positions are node centres. */
function computeLayout(g: SchemaGraph): Layout {
  const nodes = g.nodes;
  const n = nodes.length;
  if (!n) return {};
  const idx = new Map(nodes.map((d, i) => [d.name, i]));
  const size = nodes.map((d) => ({ w: NODE_W, h: nodeH(d) }));

  const k = 215; // ideal edge length (centre-to-centre)
  const pos: Pt[] = nodes.map((_, i) => {
    const a = (i / n) * Math.PI * 2;
    const r = k * 0.9 + 1;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });

  const links = g.edges
    .map((e) => [idx.get(e.source), idx.get(e.target)] as [number | undefined, number | undefined])
    .filter(([a, b]) => a != null && b != null && a !== b) as [number, number][];

  let temp = k * 0.9;
  for (let it = 0; it < 320; it++) {
    const disp: Pt[] = pos.map(() => ({ x: 0, y: 0 }));
    // repulsion (capped so two near-coincident nodes don't explode)
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
    // attraction along edges
    for (const [a, b] of links) {
      let dx = pos[a].x - pos[b].x;
      let dy = pos[a].y - pos[b].y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const f = (dist * dist) / k;
      dx /= dist; dy /= dist;
      disp[a].x -= dx * f; disp[a].y -= dy * f;
      disp[b].x += dx * f; disp[b].y += dy * f;
    }
    // gravity toward origin — keeps disconnected nodes from drifting away
    for (let i = 0; i < n; i++) {
      disp[i].x -= pos[i].x * 0.13;
      disp[i].y -= pos[i].y * 0.13;
    }
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(disp[i].x, disp[i].y) || 0.01;
      pos[i].x += (disp[i].x / d) * Math.min(d, temp);
      pos[i].y += (disp[i].y / d) * Math.min(d, temp);
    }
    temp = Math.max(temp * 0.985, 4);
  }

  // resolve overlaps on the real boxes
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const minX = (size[i].w + size[j].w) / 2 + 30;
        const minY = (size[i].h + size[j].h) / 2 + 26;
        const ox = minX - Math.abs(dx);
        const oy = minY - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          moved = true;
          if (ox < oy) {
            const s = ((dx < 0 ? -1 : 1) * ox) / 2;
            pos[i].x += s; pos[j].x -= s;
          } else {
            const s = ((dy < 0 ? -1 : 1) * oy) / 2;
            pos[i].y += s; pos[j].y -= s;
          }
        }
      }
    }
    if (!moved) break;
  }

  // recenter on the centroid so the viewport fit is deterministic
  let cx = 0, cy = 0;
  for (const p of pos) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  const out: Layout = {};
  nodes.forEach((d, i) => (out[d.name] = { x: pos[i].x - cx, y: pos[i].y - cy }));
  return out;
}

function colRowY(node: GraphNode, top: number, col: string): number {
  const i = node.columns.findIndex((c) => c.name === col);
  if (i < 0) return top + HEADER_H / 2;
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

  const [layout, setLayout] = useState<Layout>({});
  const [view, setView] = useState({ x: 0, y: 0, z: 1 }); // pan + zoom

  const vpRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "pan" | "node"; name?: string; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const gRef = useRef<SchemaGraph | null>(null);
  const layRef = useRef<Layout>({});
  const fittedRef = useRef(false);
  useEffect(() => { layRef.current = layout; }, [layout]);

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

  // neighbours of a node (for highlight)
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
    fittedRef.current = false;
    if (doFit()) fittedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.data]);

  // The panel is display:none until the Schema tab is shown, so the viewport can
  // have zero size when the graph first loads. Fit as soon as it gains size.
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!fittedRef.current && Object.keys(layRef.current).length && doFit()) fittedRef.current = true;
    });
    ro.observe(vp);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const h = nodeH(nd);
      minX = Math.min(minX, p.x - NODE_W / 2);
      maxX = Math.max(maxX, p.x + NODE_W / 2);
      minY = Math.min(minY, p.y - h / 2);
      maxY = Math.max(maxY, p.y + h / 2);
    }
    if (!isFinite(minX)) return false;
    const pad = 60;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    const z = Math.min(1, Math.max(0.2, Math.min(vp.clientWidth / w, vp.clientHeight / h)));
    setView({
      z,
      x: vp.clientWidth / 2 - ((minX + maxX) / 2) * z,
      y: vp.clientHeight / 2 - ((minY + maxY) / 2) * z,
    });
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

  // ----- pan / node drag -----
  function onPointerDown(e: React.MouseEvent, name?: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = name ? layout[name] : null;
    drag.current = {
      kind: name ? "node" : "pan",
      name,
      sx: e.clientX,
      sy: e.clientY,
      ox: name && p ? p.x : view.x,
      oy: name && p ? p.y : view.y,
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  function onMove(e: MouseEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.kind === "pan") {
      setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    } else if (d.name) {
      setView((v) => {
        setLayout((l) => ({ ...l, [d.name!]: { x: d.ox + dx / v.z, y: d.oy + dy / v.z } }));
        return v;
      });
    }
  }
  function onUp() {
    drag.current = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }
  useEffect(() => () => onUp(), []);

  function onWheel(e: React.WheelEvent) {
    const vp = vpRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const nz = Math.min(2, Math.max(0.2, v.z * (e.deltaY < 0 ? 1.12 : 0.89)));
      // keep the point under the cursor stationary
      return { z: nz, x: mx - ((mx - v.x) / v.z) * nz, y: my - ((my - v.y) / v.z) * nz };
    });
  }

  function focusNode(name: string) {
    const vp = vpRef.current;
    const p = layout[name];
    if (!vp || !p) return;
    setSel(name);
    setView((v) => ({ ...v, x: vp.clientWidth / 2 - p.x * v.z, y: vp.clientHeight / 2 - p.y * v.z }));
  }

  function zoomBy(f: number) {
    const vp = vpRef.current;
    if (!vp) return;
    const mx = vp.clientWidth / 2, my = vp.clientHeight / 2;
    setView((v) => {
      const nz = Math.min(2, Math.max(0.2, v.z * f));
      return { z: nz, x: mx - ((mx - v.x) / v.z) * nz, y: my - ((my - v.y) / v.z) * nz };
    });
  }

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

  const g = graph.data;
  const active = hover ?? sel;
  const lit = (name: string) =>
    !active || name === active || neighbours.get(active)?.has(name) || false;
  const matches = (name: string) => !!search && name.toLowerCase().includes(search.toLowerCase());

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
      {/* ---------- toolbar ---------- */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {database && (
          <div style={{ width: 168 }}>
            <DatabasePicker connId={connId} database={database} onSwitch={(db) => onSwitchDatabase(connId, db)} />
          </div>
        )}
        <select
          className="input no-drag"
          style={{ width: 150, padding: "8px 10px", fontSize: 13 }}
          value={schema ?? ""}
          onChange={(e) => { setSchema(e.target.value); setSearch(""); }}
        >
          {(schemas.data ?? []).map((s) => (
            <option key={s.name} value={s.name}>{s.name} ({s.tables})</option>
          ))}
        </select>

        <div style={{ position: "relative", width: 200 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", display: "flex" }}>
            <Icon.search w={13} />
          </span>
          <input
            className="input no-drag"
            style={{ padding: "8px 10px 8px 30px", fontSize: 12.5 }}
            placeholder="Find a table…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && g) {
                const hit = g.nodes.find((nd) => matches(nd.name));
                if (hit) focusNode(hit.name);
              }
            }}
          />
        </div>

        {g && (
          <span className="chip mono" title="tables · relationships">
            {g.nodes.length} tables · {g.edges.length} links
          </span>
        )}

        <div style={{ flex: 1 }} />

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
        onWheel={onWheel}
        onClick={() => setSel(null)}
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
          <div
            className="erd-canvas"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
          >
            {/* edges */}
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
                const sTop = sp.y - nodeH(sNode) / 2;
                const tTop = tp.y - nodeH(tNode) / 2;
                const dir = tp.x >= sp.x ? 1 : -1;
                const sx = sp.x + dir * (NODE_W / 2);
                const sy = colRowY(sNode, sTop, e.source_columns[0]);
                const tx = tp.x - dir * (NODE_W / 2);
                const ty = colRowY(tNode, tTop, e.target_columns[0]);
                const curve = Math.max(36, Math.abs(tx - sx) * 0.4);
                const on = lit(e.source) && lit(e.target) && (!active || e.source === active || e.target === active);
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

            {/* nodes */}
            {g.nodes.map((nd) => {
              const p = layout[nd.name];
              if (!p) return null;
              const h = nodeH(nd);
              const dim = !!active && !lit(nd.name);
              return (
                <div
                  key={nd.name}
                  className={`erd-node ${nd.name === sel ? "sel" : ""} ${dim ? "dim" : ""} ${matches(nd.name) ? "match" : ""}`}
                  style={{ left: p.x - NODE_W / 2, top: p.y - h / 2, width: NODE_W }}
                  onMouseEnter={() => setHover(nd.name)}
                  onMouseLeave={() => setHover((hh) => (hh === nd.name ? null : hh))}
                  onClick={(e) => { e.stopPropagation(); setSel((s) => (s === nd.name ? null : nd.name)); }}
                  onMouseDown={(e) => onPointerDown(e, nd.name)}
                >
                  <div className="erd-node-head" style={{ height: HEADER_H }}>
                    <span style={{ display: "flex", opacity: 0.8 }}>
                      {nd.kind === "v" || nd.kind === "m" ? <Icon.eye w={13} /> : <Icon.table w={13} />}
                    </span>
                    <span className="nm mono">{nd.name}</span>
                    <span className="erd-kind">{nd.est_rows >= 0 ? estRows(nd.est_rows) : (TABLE_KINDS[nd.kind] ?? nd.kind)}</span>
                  </div>
                  <div>
                    {nd.columns.map((c) => (
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
                </div>
              );
            })}
          </div>
        )}

        {/* legend */}
        {g && g.nodes.length > 0 && (
          <div className="erd-legend mono">
            <span><span style={{ color: "var(--accent)" }}><Icon.key w={10} /></span> primary key</span>
            <span><span style={{ color: "var(--accent-2)" }}><Icon.link w={10} /></span> foreign key</span>
          </div>
        )}
      </div>
    </div>
  );
}
