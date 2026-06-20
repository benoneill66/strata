import type { AgentEvent, AiStatus, CellValue, ChatMsg, ColumnInfo, ConnectionProfile, DbInfo, Filter, MonitorSnapshot, QualifiedTable, QueryResult, RelatedExportSummary, RowUpdate, SchemaGraph, SchemaInfo, Settings, SqlSuggestion, TableInfo, TableRelations } from "./types";
import * as demo from "./demo";

export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Dynamic import so the browser dev build never loads the Tauri bridge.
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const mod = await import("@tauri-apps/api/core");
  return mod.invoke<T>(cmd, args);
}

const demoSettings: Settings = { connections: demo.demoConnections, row_limit: 200, ai_provider: "claude", install_id: "demo", telemetry_enabled: false };
const demoConnected = new Set<string>();

export const api = {
  getSettings: (): Promise<Settings> =>
    IS_TAURI ? invoke("get_settings") : demo.wait(demoSettings, 80),

  saveSettings: (settings: Settings): Promise<void> => {
    if (IS_TAURI) return invoke("save_settings", { settings });
    demoSettings.connections = settings.connections;
    demoSettings.row_limit = settings.row_limit;
    demoSettings.telemetry_enabled = settings.telemetry_enabled;
    return demo.wait(undefined, 80);
  },

  testConnection: (profile: ConnectionProfile): Promise<string> =>
    IS_TAURI ? invoke("test_connection", { profile }) : demo.wait("PostgreSQL 16.4 (demo)", 600),

  connectDb: (id: string): Promise<DbInfo> => {
    if (IS_TAURI) return invoke("connect_db", { id });
    demoConnected.add(id);
    return demo.wait({ id, version: "16.4", database: "analytics", user: "postgres" }, 500);
  },

  switchDatabase: (id: string, database: string): Promise<DbInfo> => {
    if (IS_TAURI) return invoke("switch_database", { id, database });
    return demo.wait({ id, version: "16.4", database, user: "postgres" }, 400);
  },

  listDatabases: (id: string): Promise<string[]> =>
    IS_TAURI ? invoke("list_databases", { id }) : demo.wait(demo.demoDatabases, 120),

  disconnectDb: (id: string): Promise<void> => {
    if (IS_TAURI) return invoke("disconnect_db", { id });
    demoConnected.delete(id);
    return demo.wait(undefined, 120);
  },

  connectedIds: (): Promise<string[]> =>
    IS_TAURI ? invoke("connected_ids") : demo.wait([...demoConnected], 60),

  listSchemas: (id: string): Promise<SchemaInfo[]> =>
    IS_TAURI ? invoke("list_schemas", { id }) : demo.wait(demo.demoSchemas),

  listTables: (id: string, schema: string): Promise<TableInfo[]> =>
    IS_TAURI ? invoke("list_tables", { id, schema }) : demo.wait(demo.demoTables[schema] ?? []),

  listAllTables: (id: string): Promise<QualifiedTable[]> =>
    IS_TAURI ? invoke("list_all_tables", { id }) : demo.wait(demo.demoAllTables(), 120),

  tableColumns: (id: string, schema: string, table: string): Promise<ColumnInfo[]> =>
    IS_TAURI ? invoke("table_columns", { id, schema, table }) : demo.wait(demo.demoColumns, 150),

  schemaGraph: (id: string, schema: string): Promise<SchemaGraph> =>
    IS_TAURI ? invoke("schema_graph", { id, schema }) : demo.wait(demo.demoGraph(schema), 260),

  tableRelations: (id: string, schema: string, table: string): Promise<TableRelations> =>
    IS_TAURI ? invoke("table_relations", { id, schema, table }) : demo.wait(demo.demoRelations(schema, table), 150),

  monitorSnapshot: (id: string): Promise<MonitorSnapshot> =>
    IS_TAURI ? invoke("monitor_snapshot", { id }) : demo.wait(demo.demoMonitor(), 180),

  terminateBackend: (id: string, pid: number): Promise<void> =>
    IS_TAURI ? invoke("terminate_backend", { id, pid }) : demo.wait(undefined, 200),

  createView: (id: string, schema: string, name: string, sql: string): Promise<void> =>
    IS_TAURI ? invoke("create_view", { id, schema, name, sql }) : demo.wait(undefined, 300),

  serverLogs: (id: string, lines: number): Promise<string[]> =>
    IS_TAURI ? invoke("server_logs", { id, lines }) : demo.wait(["Log line 1", "Log line 2", "Log line 3"], 200),

  tableRows: (
    id: string,
    schema: string,
    table: string,
    limit: number,
    offset: number,
    orderBy: string | null,
    orderDesc: boolean,
    filters: Filter[]
  ): Promise<QueryResult> =>
    IS_TAURI
      ? invoke("table_rows", { id, schema, table, limit, offset, orderBy, orderDesc, filters })
      : demo.wait(demo.demoRows(limit, offset, filters)),

  tableCount: (id: string, schema: string, table: string, filters: Filter[]): Promise<number> =>
    IS_TAURI ? invoke("table_count", { id, schema, table, filters }) : demo.wait(48211, 700),

  updateRows: (id: string, schema: string, table: string, updates: RowUpdate[]): Promise<number> =>
    IS_TAURI ? invoke("update_rows", { id, schema, table, updates }) : demo.wait(updates.length, 250),

  insertRow: (id: string, schema: string, table: string, values: CellValue[]): Promise<number> =>
    IS_TAURI ? invoke("insert_row", { id, schema, table, values }) : demo.wait(1, 250),

  deleteRow: (id: string, schema: string, table: string, keys: CellValue[]): Promise<number> =>
    IS_TAURI ? invoke("delete_row", { id, schema, table, keys }) : demo.wait(1, 250),

  runQuery: (id: string, sql: string, maxRows: number): Promise<QueryResult> =>
    IS_TAURI ? invoke("run_query", { id, sql, maxRows }) : demo.wait(demo.demoRows(50, 0, [])),

  // Full-result exports re-query without the page limit and write the file in
  // Rust; the path comes from the native save dialog. (Tauri only — the demo
  // path serializes the in-memory result client-side, see ExportMenu.)
  exportTable: (
    id: string,
    schema: string,
    table: string,
    orderBy: string | null,
    orderDesc: boolean,
    filters: Filter[],
    format: string,
    path: string
  ): Promise<number> =>
    invoke("export_table", { id, schema, table, orderBy, orderDesc, filters, format, path }),

  exportQuery: (id: string, sql: string, format: string, path: string): Promise<number> =>
    invoke("export_query", { id, sql, format, path }),

  // Export a record and everything that references it (following FKs down) to a
  // folder of CSVs. `keys` are the seed row's primary-key values; `dir` is the
  // folder chosen via pickDirectory. (Tauri only — no demo backend to crawl.)
  exportRelated: (
    id: string,
    schema: string,
    table: string,
    keys: CellValue[],
    dir: string
  ): Promise<RelatedExportSummary> =>
    IS_TAURI
      ? invoke("export_related", { id, schema, table, keys, dir })
      : demo.wait(
          { dir: `${dir}/${table}`, tables: [{ schema, table, row_count: 1 }], total_rows: 1, truncated: false },
          400
        ),

  explainQuery: (id: string, sql: string, analyze: boolean): Promise<string> =>
    IS_TAURI ? invoke("explain_query", { id, sql, analyze }) : demo.wait(demo.demoPlan(analyze), 450),

  diagnosePlan: (sql: string, plan: string): Promise<string> =>
    IS_TAURI
      ? invoke("diagnose_plan", { sql, plan })
      : demo.wait("The Seq Scan on orders dominates (~70% of execution) because status has no index. CREATE INDEX ON orders (status) — or a partial index WHERE status = 'paid' — would let the join probe far fewer rows.", 900),

  aiStatus: (): Promise<AiStatus> =>
    IS_TAURI
      ? invoke("ai_status")
      : demo.wait({
          provider: demoSettings.ai_provider,
          available: true,
          path: "demo",
          model: demoSettings.ai_provider === "codex" ? "gpt-5.4-mini" : "sonnet",
          effort: "low",
          claude_path: "demo",
          codex_path: "demo",
        }, 60),

  generateSql: (id: string, question: string): Promise<SqlSuggestion> =>
    IS_TAURI ? invoke("generate_sql", { id, question }) : demo.wait(demo.demoSuggestion(question), 900),

  // Chat agent: a streaming ReAct loop in Rust. `onEvent` fires for each query
  // step, answer token, and completion; the promise resolves when the stream
  // ends. (Demo path simulates the stream client-side.)
  agentChat: async (
    id: string,
    schema: string | null,
    messages: ChatMsg[],
    onEvent: (e: AgentEvent) => void
  ): Promise<void> => {
    if (!IS_TAURI) return demo.demoAgentStream(messages, onEvent);
    const { Channel } = await import("@tauri-apps/api/core");
    const channel = new Channel<AgentEvent>();
    channel.onmessage = onEvent;
    return invoke("agent_chat", { id, schema, messages, onEvent: channel });
  },
};

// ---------- native window helpers ----------

// -webkit-app-region is unreliable in Tauri's macOS webview, so drag manually
// from container mousedown, skipping interactive elements.
const INTERACTIVE = "button,input,select,textarea,a,[role='switch'],.no-drag";

export async function startWindowDrag(e: React.MouseEvent) {
  if (!IS_TAURI || e.button !== 0) return;
  if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

export async function toggleMaximize() {
  if (!IS_TAURI) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().toggleMaximize();
}

// ---------- file export helpers ----------

/** Native "Save As…" dialog. Returns the chosen path, or null if cancelled. */
export async function saveDialog(defaultName: string, extension: string): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({
    defaultPath: defaultName,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
}

/** Native folder picker. Returns the chosen directory, or null if cancelled or
    not running under Tauri. */
export async function pickDirectory(): Promise<string | null> {
  if (!IS_TAURI) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false });
  return typeof picked === "string" ? picked : null;
}

/** Open a URL in the user's default browser (falls back to window.open in dev). */
export async function openExternal(url: string): Promise<void> {
  if (IS_TAURI) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** Browser/demo fallback: trigger a download from an in-memory string. */
export function browserDownload(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
