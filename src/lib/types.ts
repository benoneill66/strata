// Mirrors src-tauri/src/models.rs (snake_case on both sides).

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl_mode: string; // prefer | require | disable
  color: string;
}

export interface Settings {
  connections: ConnectionProfile[];
  row_limit: number;
}

export interface DbInfo {
  id: string;
  version: string;
  database: string;
  user: string;
}

export interface SchemaInfo {
  name: string;
  tables: number;
}

export interface TableInfo {
  name: string;
  kind: string; // r | p | v | m | f
  est_rows: number;
  size_bytes: number;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  is_pk: boolean;
  default: string | null;
}

export interface Filter {
  column: string;
  op: FilterOp;
  value: string;
}

export type FilterOp = "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte" | "null" | "notnull";

/** One column/value pair in a row mutation; null means SQL NULL. */
export interface CellValue {
  column: string;
  value: string | null;
}

/** One row's staged edits: primary-key values plus the column changes. */
export interface RowUpdate {
  keys: CellValue[];
  changes: CellValue[];
}

export const FILTER_OPS: { id: FilterOp; label: string; needsValue: boolean }[] = [
  { id: "contains", label: "contains", needsValue: true },
  { id: "eq", label: "=", needsValue: true },
  { id: "neq", label: "≠", needsValue: true },
  { id: "gt", label: ">", needsValue: true },
  { id: "gte", label: "≥", needsValue: true },
  { id: "lt", label: "<", needsValue: true },
  { id: "lte", label: "≤", needsValue: true },
  { id: "null", label: "is null", needsValue: false },
  { id: "notnull", label: "not null", needsValue: false },
];

export interface GraphColumn {
  name: string;
  data_type: string;
  is_pk: boolean;
  is_fk: boolean;
}

export interface GraphNode {
  name: string;
  kind: string;
  est_rows: number;
  columns: GraphColumn[];
}

export interface GraphEdge {
  name: string;
  source: string;
  source_columns: string[];
  target: string;
  target_columns: string[];
}

export interface SchemaGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface AiStatus {
  available: boolean;
  path: string;
}

export interface SqlSuggestion {
  sql: string;
  explanation: string;
}

export interface QueryResult {
  columns: string[];
  rows: (string | null)[][];
  affected: number | null;
  elapsed_ms: number;
  truncated: boolean;
}

export const TABLE_KINDS: Record<string, string> = {
  r: "table",
  p: "partitioned",
  v: "view",
  m: "matview",
  f: "foreign",
};
