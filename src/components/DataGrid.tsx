import { useEffect, useRef, useState } from "react";
import type { QueryResult } from "../lib/types";

/** Shared results grid: sticky header, mono cells, dimmed NULLs, optional
    sortable headers, row click-through and double-click cell editing.
    Used by Browse and Query. */
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
}) {
  const [edit, setEdit] = useState<{ r: number; c: number; draft: string } | null>(null);
  // Single click opens the row drawer, double click edits a cell — when both
  // are wired, delay the click so a double-click can cancel it.
  const clickTimer = useRef<number | null>(null);

  useEffect(() => setEdit(null), [result]);
  useEffect(() => () => { if (clickTimer.current) window.clearTimeout(clickTimer.current); }, []);

  function rowClick(row: (string | null)[]) {
    if (!onRowClick) return;
    if (!onEditCell) {
      onRowClick(row);
      return;
    }
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => onRowClick(row), 240);
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
  return (
    <div className="data-wrap no-drag">
      <table className="data-table">
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
          {result.rows.map((row, i) => (
            <tr key={i} onClick={onRowClick ? () => rowClick(row) : undefined} style={onRowClick ? { cursor: "default" } : undefined}>
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
                ) : (
                  <td
                    key={j}
                    className={`${cell === null ? "null" : ""} ${dirtyCells?.has(`${i}:${j}`) ? "dirty" : ""}`}
                    title={cell ?? "NULL"}
                    onDoubleClick={onEditCell ? () => startEdit(i, j, cell) : undefined}
                  >
                    {cell === null ? "NULL" : cell === "" ? <span style={{ opacity: 0.4 }}>∅</span> : cell}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length === 0 && (
        <div style={{ padding: "34px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No rows</div>
      )}
    </div>
  );
}
