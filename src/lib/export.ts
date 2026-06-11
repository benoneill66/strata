// Export formats and a client-side serializer. The serializer mirrors
// src-tauri/src/export.rs and is only used on the browser/demo path (no Tauri
// backend); the real desktop export streams from Rust against the full,
// re-queried result set.

import type { QueryResult } from "./types";

export type ExportFormat = "csv" | "tsv" | "json" | "sql";

export const EXPORT_FORMATS: { id: ExportFormat; label: string; ext: string; mime: string }[] = [
  { id: "csv", label: "CSV", ext: "csv", mime: "text/csv" },
  { id: "tsv", label: "TSV", ext: "tsv", mime: "text/tab-separated-values" },
  { id: "json", label: "JSON", ext: "json", mime: "application/json" },
  { id: "sql", label: "SQL INSERTs", ext: "sql", mime: "text/plain" },
];

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
const quoteLit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** RFC-4180-style quoting, parameterised on the delimiter (serves CSV and TSV). */
function field(s: string, delim: string): string {
  return s.includes(delim) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize a result set. `table` is the (quoted) INSERT target for SQL. */
export function renderExport(fmt: ExportFormat, result: QueryResult, table: string): string {
  const { columns, rows } = result;
  if (fmt === "json") {
    return JSON.stringify(
      rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? null]))),
      null,
      2
    );
  }
  if (fmt === "sql") {
    const cols = columns.map(quoteIdent).join(", ");
    return (
      rows
        .map((r) => `INSERT INTO ${table} (${cols}) VALUES (${r.map((v) => (v === null ? "NULL" : quoteLit(v))).join(", ")});`)
        .join("\n") + "\n"
    );
  }
  const delim = fmt === "tsv" ? "\t" : ",";
  const line = (vals: (string | null)[]) => vals.map((v) => (v === null ? "" : field(v, delim))).join(delim);
  return [line(columns), ...rows.map(line)].join("\n") + "\n";
}
