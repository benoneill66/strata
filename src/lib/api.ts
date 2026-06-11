import type { AiStatus, CellValue, ColumnInfo, ConnectionProfile, DbInfo, Filter, QueryResult, SchemaGraph, SchemaInfo, Settings, SqlSuggestion, TableInfo } from "./types";
import * as demo from "./demo";

export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Dynamic import so the browser dev build never loads the Tauri bridge.
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const mod = await import("@tauri-apps/api/core");
  return mod.invoke<T>(cmd, args);
}

const demoSettings: Settings = { connections: demo.demoConnections, row_limit: 200 };
const demoConnected = new Set<string>();

export const api = {
  getSettings: (): Promise<Settings> =>
    IS_TAURI ? invoke("get_settings") : demo.wait(demoSettings, 80),

  saveSettings: (settings: Settings): Promise<void> => {
    if (IS_TAURI) return invoke("save_settings", { settings });
    demoSettings.connections = settings.connections;
    demoSettings.row_limit = settings.row_limit;
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

  tableColumns: (id: string, schema: string, table: string): Promise<ColumnInfo[]> =>
    IS_TAURI ? invoke("table_columns", { id, schema, table }) : demo.wait(demo.demoColumns, 150),

  schemaGraph: (id: string, schema: string): Promise<SchemaGraph> =>
    IS_TAURI ? invoke("schema_graph", { id, schema }) : demo.wait(demo.demoGraph(schema), 260),

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

  updateRow: (id: string, schema: string, table: string, keys: CellValue[], changes: CellValue[]): Promise<number> =>
    IS_TAURI ? invoke("update_row", { id, schema, table, keys, changes }) : demo.wait(1, 250),

  insertRow: (id: string, schema: string, table: string, values: CellValue[]): Promise<number> =>
    IS_TAURI ? invoke("insert_row", { id, schema, table, values }) : demo.wait(1, 250),

  deleteRow: (id: string, schema: string, table: string, keys: CellValue[]): Promise<number> =>
    IS_TAURI ? invoke("delete_row", { id, schema, table, keys }) : demo.wait(1, 250),

  runQuery: (id: string, sql: string, maxRows: number): Promise<QueryResult> =>
    IS_TAURI ? invoke("run_query", { id, sql, maxRows }) : demo.wait(demo.demoRows(50, 0, [])),

  aiStatus: (): Promise<AiStatus> =>
    IS_TAURI ? invoke("ai_status") : demo.wait({ available: true, path: "demo" }, 60),

  generateSql: (id: string, question: string): Promise<SqlSuggestion> =>
    IS_TAURI ? invoke("generate_sql", { id, question }) : demo.wait(demo.demoSuggestion(question), 900),
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
