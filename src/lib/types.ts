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
  ai_provider: AiProvider;
  install_id: string;
  telemetry_enabled: boolean;
}

export type AiProvider = "claude" | "codex";

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

/** A relation qualified by schema — the ⌘K palette's jump targets. */
export interface QualifiedTable {
  schema: string;
  name: string;
  kind: string;
  est_rows: number;
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

/** A foreign-key edge oriented for navigation (mirrors models.rs::FkRef). To
    follow it, jump to other_schema.other_table and filter each other_columns[i]
    to the current row's value at local_columns[i] — same shape both directions. */
export interface FkRef {
  constraint: string;
  local_columns: string[];
  other_schema: string;
  other_table: string;
  other_columns: string[];
}

export interface TableRelations {
  outgoing: FkRef[]; // FKs on this table → parent rows
  incoming: FkRef[]; // FKs on other tables → child rows
}

export interface MonitorOverview {
  database: string;
  server_version: string;
  size_bytes: number;
  uptime_seconds: number;
  max_connections: number;
  total_connections: number;
  active_connections: number;
  idle_in_transaction: number;
  waiting_connections: number;
  xact_commit: number;
  xact_rollback: number;
  blks_read: number;
  blks_hit: number;
  cache_hit_pct: number;
  deadlocks: number;
  temp_bytes: number;
  stats_reset: string | null;
}

export interface MonitorActivity {
  pid: number;
  user: string;
  application: string;
  client: string;
  state: string;
  wait: string;
  duration_seconds: number;
  query: string;
}

export interface MonitorLock {
  blocked_pid: number;
  blocked_user: string;
  blocking_pid: number;
  locktype: string;
  mode: string;
  relation: string;
  duration_seconds: number;
  blocked_query: string;
  blocking_query: string;
}

export interface MonitorTableHealth {
  schema: string;
  table: string;
  size_bytes: number;
  live_rows: number;
  dead_rows: number;
  seq_scan: number;
  idx_scan: number;
  last_vacuum: string | null;
  last_analyze: string | null;
}

export interface MonitorStatement {
  query: string;
  calls: number;
  total_ms: number;
  mean_ms: number;
  rows: number;
}

export interface MonitorSnapshot {
  sampled_at_ms: number;
  overview: MonitorOverview;
  activity: MonitorActivity[];
  locks: MonitorLock[];
  tables: MonitorTableHealth[];
  statements_available: boolean;
  statements_error: string | null;
  statements: MonitorStatement[];
}

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
  provider: AiProvider;
  available: boolean;
  path: string;
  model: string;
  effort: string;
  claude_path: string;
  codex_path: string;
}

export interface SqlSuggestion {
  sql: string;
  explanation: string;
}

/** One message in an agent conversation. */
export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

/** Streamed from `agent_chat` over a Tauri channel. */
export type AgentEvent =
  | {
      type: "step";
      sql: string;
      columns: string[];
      rows: (string | null)[][];
      row_count: number;
      truncated: boolean;
      error: string | null;
    }
  | { type: "token"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

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
