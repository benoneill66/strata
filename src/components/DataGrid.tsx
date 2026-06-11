import type { QueryResult } from "../lib/types";

/** Shared results grid: sticky header, mono cells, dimmed NULLs, optional
    sortable headers and row click-through. Used by Browse and Query. */
export function DataGrid({
  result,
  startIndex = 0,
  sortCol,
  sortDesc,
  onSort,
  onRowClick,
  pkCols,
}: {
  result: QueryResult;
  startIndex?: number;
  sortCol?: string | null;
  sortDesc?: boolean;
  onSort?: (col: string) => void;
  onRowClick?: (row: (string | null)[]) => void;
  pkCols?: Set<string>;
}) {
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
            <tr key={i} onClick={onRowClick ? () => onRowClick(row) : undefined} style={onRowClick ? { cursor: "default" } : undefined}>
              <td className="idx">{startIndex + i + 1}</td>
              {row.map((cell, j) => (
                <td key={j} className={cell === null ? "null" : ""} title={cell ?? "NULL"}>
                  {cell === null ? "NULL" : cell === "" ? <span style={{ opacity: 0.4 }}>∅</span> : cell}
                </td>
              ))}
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
