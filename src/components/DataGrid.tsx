import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { QueryResult } from "../lib/types";

// Rows beyond the viewport are not rendered; this many are kept above/below as
// a scroll buffer so fast flicks don't show blank gaps.
const OVERSCAN = 12;

/** Shared results grid: sticky header, mono cells, dimmed NULLs, optional
    sortable headers, row click-through and double-click cell editing.
    Used by Browse and Query.

    Rows are virtualized — only the visible window (plus an overscan buffer) is
    in the DOM, with spacer rows padding the scroll height — so a 1,000-row page
    on a wide table doesn't build tens of thousands of cells. Because the header
    shares the table with the body, column widths are measured once per result
    (while auto-layout fits them to content) and then frozen via a colgroup, so
    the header stays aligned as the rendered row set changes during scroll. */
export function DataGrid({
  result,
  startIndex = 0,
  sortCol,
  sortDesc,
  onSort,
  onRowClick,
  pkCols,
  onEditCell,
  dirtyCells,
  fkCols,
  onFkClick,
}: {
  result: QueryResult;
  startIndex?: number;
  sortCol?: string | null;
  sortDesc?: boolean;
  onSort?: (col: string) => void;
  onRowClick?: (row: (string | null)[]) => void;
  pkCols?: Set<string>;
  /** Enables double-click editing; stages the value locally (synchronous). */
  onEditCell?: (rowIndex: number, colIndex: number, value: string | null) => void;
  /** "row:col" cells with staged, unsaved edits — rendered highlighted. */
  dirtyCells?: Set<string>;
  /** Columns that are part of an outgoing foreign key — get a jump affordance. */
  fkCols?: Set<string>;
  /** Follow the FK on this cell's column to the referenced row. */
  onFkClick?: (column: string, row: (string | null)[]) => void;
}) {
  const [edit, setEdit] = useState<{ r: number; c: number; draft: string } | null>(null);
  // Single click opens the row drawer, double click edits a cell — when both
  // are wired, delay the click so a double-click can cancel it.
  const clickTimer = useRef<number | null>(null);

  // virtualization
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const [rowH, setRowH] = useState(32);
  // frozen column widths (incl. the leading index column), measured per result
  const [colW, setColW] = useState<number[] | null>(null);

  // New result → drop frozen widths and edit state, scroll back to the top.
  // Resetting during render (the documented "prop changed" pattern) means the
  // remeasure happens with auto layout before the browser paints — no flash.
  const prevResult = useRef(result);
  if (prevResult.current !== result) {
    prevResult.current = result;
    if (colW !== null) setColW(null);
    if (scrollTop !== 0) setScrollTop(0);
    if (edit) setEdit(null);
  }

  useEffect(() => () => { if (clickTimer.current) window.clearTimeout(clickTimer.current); }, []);

  // Track the scroll container's height (viewport) for the window math.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewport(wrap.clientHeight || 600));
    ro.observe(wrap);
    setViewport(wrap.clientHeight || 600);
    return () => ro.disconnect();
  }, []);

  // After each render: keep the top scrolled, measure row height, and freeze
  // column widths the first time (while colW is null → table is auto-layout).
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (colW === null && wrap.scrollTop !== 0) wrap.scrollTop = 0;
    const tr = wrap.querySelector("tbody tr[data-real]") as HTMLElement | null;
    if (tr && tr.offsetHeight) setRowH(tr.offsetHeight);
    if (colW === null) {
      const ths = wrap.querySelectorAll("thead th");
      if (ths.length) setColW(Array.from(ths, (th) => (th as HTMLElement).offsetWidth));
    }
  }, [result, colW]);

  function rowClick(row: (string | null)[], e: React.MouseEvent) {
    if (!onRowClick) return;
    if (!onEditCell) {
      onRowClick(row);
      return;
    }
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
    // the second click of a double-click cancels the drawer; only a lone
    // first click schedules it
    if (e.detail > 1) {
      clickTimer.current = null;
      return;
    }
    // once the drawer's scrim is up a double-click can't reach the cell at
    // all, so the delay must outlast a slow double-click's gap
    clickTimer.current = window.setTimeout(() => onRowClick(row), 350);
  }

  function startEdit(r: number, c: number, cell: string | null) {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    setEdit({ r, c, draft: cell ?? "" });
  }

  function commit(value: string | null) {
    if (!edit || !onEditCell) return;
    onEditCell(edit.r, edit.c, value);
    setEdit(null);
  }

  if (!result.columns.length) return null;

  // The visible window of row indices, plus spacer heights above/below.
  const total = result.rows.length;
  const span = colW?.length ?? result.columns.length + 1;
  const start = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN);
  const end = Math.min(total, start + Math.ceil(viewport / rowH) + OVERSCAN * 2);
  const padTop = start * rowH;
  const padBottom = Math.max(0, (total - end) * rowH);

  function renderRow(i: number) {
    const row = result.rows[i];
    return (
      <tr key={i} data-real onClick={onRowClick ? (e) => rowClick(row, e) : undefined} style={onRowClick ? { cursor: "default" } : undefined}>
        <td className="idx">{startIndex + i + 1}</td>
        {row.map((cell, j) =>
          edit && edit.r === i && edit.c === j ? (
            <td key={j} className="editing" onClick={(e) => e.stopPropagation()}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  className="cell-input"
                  autoFocus
                  value={edit.draft}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEdit((s) => (s ? { ...s, draft: e.target.value } : s))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit(edit.draft);
                    if (e.key === "Escape") setEdit(null);
                  }}
                  onBlur={() => setEdit(null)}
                />
                <button
                  className="cell-null-btn"
                  title="Set NULL"
                  // mousedown (not click) so the input's blur doesn't cancel first
                  onMouseDown={(e) => { e.preventDefault(); commit(null); }}
                >
                  ∅
                </button>
              </span>
            </td>
          ) : (() => {
            const isFk = fkCols?.has(result.columns[j]) && cell !== null && !!onFkClick;
            return (
              <td
                key={j}
                className={`${cell === null ? "null" : ""} ${dirtyCells?.has(`${i}:${j}`) ? "dirty" : ""} ${isFk ? "cell-fk" : ""}`}
                title={cell ?? "NULL"}
                onDoubleClick={onEditCell ? () => startEdit(i, j, cell) : undefined}
              >
                {cell === null ? "NULL" : cell === "" ? <span style={{ opacity: 0.4 }}>∅</span> : cell}
                {isFk && (
                  <button
                    className="fk-jump"
                    title={`Go to ${result.columns[j]} → referenced row`}
                    onClick={(e) => { e.stopPropagation(); onFkClick!(result.columns[j], row); }}
                  >
                    ↗
                  </button>
                )}
              </td>
            );
          })()
        )}
      </tr>
    );
  }

  const visible = [];
  for (let i = start; i < end; i++) visible.push(renderRow(i));

  return (
    <div className="data-wrap no-drag" ref={wrapRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <table className="data-table" style={colW ? { tableLayout: "fixed" } : undefined}>
        {colW && (
          <colgroup>
            {colW.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
        )}
        <thead>
          <tr>
            <th className="idx">#</th>
            {result.columns.map((c) => {
              const sorted = sortCol === c;
              return (
                <th
                  key={c}
                  className={`${onSort ? "sortable" : ""} ${sorted ? "sorted" : ""}`}
                  onClick={onSort ? () => onSort(c) : undefined}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    {pkCols?.has(c) && <span style={{ color: "var(--accent)", opacity: 0.9, fontSize: 9 }}>⚷</span>}
                    {c}
                    {sorted && <span style={{ fontSize: 9 }}>{sortDesc ? "▼" : "▲"}</span>}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && <tr aria-hidden="true"><td colSpan={span} style={{ height: padTop, padding: 0, border: 0 }} /></tr>}
          {visible}
          {padBottom > 0 && <tr aria-hidden="true"><td colSpan={span} style={{ height: padBottom, padding: 0, border: 0 }} /></tr>}
        </tbody>
      </table>
      {result.rows.length === 0 && (
        <div style={{ padding: "34px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No rows</div>
      )}
    </div>
  );
}
