// Fictional data for browser dev (bun run dev) — lets the UI render without
// the Tauri backend or a real database, and keeps screenshots clean.

import type { ColumnInfo, ConnectionProfile, Filter, FkRef, GraphNode, MonitorSnapshot, QualifiedTable, QueryResult, SchemaGraph, SchemaInfo, TableInfo, TableRelations } from "./types";

export const demoConnections: ConnectionProfile[] = [
  {
    id: "demo-local",
    name: "Local · analytics",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "",
    database: "analytics",
    ssl_mode: "prefer",
    color: "#4fa8ff",
  },
  {
    id: "demo-prod",
    name: "Prod · core (RDS)",
    host: "core.cluster-abc123.eu-west-1.rds.amazonaws.com",
    port: 5432,
    user: "app_ro",
    password: "••••",
    database: "core",
    ssl_mode: "require",
    color: "#38d9c4",
  },
];

export const demoDatabases = ["analytics", "core", "postgres", "reporting"];

export const demoSchemas: SchemaInfo[] = [
  { name: "public", tables: 6 },
  { name: "auth", tables: 2 },
];

export const demoTables: Record<string, TableInfo[]> = {
  public: [
    { name: "users", kind: "r", est_rows: 48211, size_bytes: 18 * 1024 * 1024 },
    { name: "orders", kind: "r", est_rows: 391207, size_bytes: 142 * 1024 * 1024 },
    { name: "products", kind: "r", est_rows: 1240, size_bytes: 3 * 1024 * 1024 },
    { name: "subscriptions", kind: "r", est_rows: 9210, size_bytes: 6 * 1024 * 1024 },
    { name: "events", kind: "p", est_rows: 8120441, size_bytes: 2 * 1024 * 1024 * 1024 },
    { name: "daily_revenue", kind: "m", est_rows: 730, size_bytes: 512 * 1024 },
  ],
  auth: [
    { name: "sessions", kind: "r", est_rows: 18733, size_bytes: 9 * 1024 * 1024 },
    { name: "api_keys", kind: "r", est_rows: 64, size_bytes: 96 * 1024 },
  ],
};

export function demoAllTables(): QualifiedTable[] {
  return Object.entries(demoTables).flatMap(([schema, tables]) =>
    tables.map((t) => ({ schema, name: t.name, kind: t.kind, est_rows: t.est_rows }))
  );
}

export const demoColumns: ColumnInfo[] = [
  { name: "id", data_type: "uuid", nullable: false, is_pk: true, default: "gen_random_uuid()" },
  { name: "email", data_type: "text", nullable: false, is_pk: false, default: null },
  { name: "name", data_type: "text", nullable: true, is_pk: false, default: null },
  { name: "plan", data_type: "text", nullable: false, is_pk: false, default: "'free'::text" },
  { name: "mrr_cents", data_type: "integer", nullable: false, is_pk: false, default: "0" },
  { name: "created_at", data_type: "timestamptz", nullable: false, is_pk: false, default: "now()" },
];

const FIRST = ["Ada", "Grace", "Alan", "Edsger", "Barbara", "Donald", "Margaret", "Dennis", "Ken", "Linus"];
const LAST = ["Lovelace", "Hopper", "Turing", "Dijkstra", "Liskov", "Knuth", "Hamilton", "Ritchie", "Thompson", "Torvalds"];
const PLANS = ["free", "pro", "team", "enterprise"];

function demoRow(i: number): (string | null)[] {
  const f = FIRST[i % FIRST.length];
  const l = LAST[(i * 7) % LAST.length];
  return [
    `c0ffee${String(i).padStart(6, "0")}-0000-4000-8000-1234567890ab`,
    `${f.toLowerCase()}.${l.toLowerCase()}@example.com`,
    i % 9 === 0 ? null : `${f} ${l}`,
    PLANS[(i * 3) % PLANS.length],
    String((i * 1290) % 49900),
    `2026-0${(i % 5) + 1}-1${i % 9} 0${i % 9}:1${i % 5}:00+00`,
  ];
}

export function demoRows(limit: number, offset: number, filters: Filter[]): QueryResult {
  const all = Array.from({ length: 480 }, (_, i) => demoRow(i));
  const cols = demoColumns.map((c) => c.name);
  const filtered = all.filter((r) =>
    filters.every((f) => {
      const v = r[cols.indexOf(f.column)] ?? "";
      if (f.op === "contains") return v.toLowerCase().includes(f.value.toLowerCase());
      if (f.op === "eq") return v === f.value;
      if (f.op === "neq") return v !== f.value;
      if (f.op === "null") return r[cols.indexOf(f.column)] === null;
      if (f.op === "notnull") return r[cols.indexOf(f.column)] !== null;
      return true;
    })
  );
  return {
    columns: cols,
    rows: filtered.slice(offset, offset + limit),
    affected: null,
    elapsed_ms: 12,
    truncated: false,
  };
}

// ---------- schema graph (ER diagram demo) ----------

function gnode(name: string, kind: string, est: number, cols: [string, string, boolean?, boolean?][]): GraphNode {
  return {
    name,
    kind,
    est_rows: est,
    columns: cols.map(([n, t, pk, fk]) => ({ name: n, data_type: t, is_pk: !!pk, is_fk: !!fk })),
  };
}

const demoGraphPublic: SchemaGraph = {
  nodes: [
    gnode("users", "r", 48211, [
      ["id", "uuid", true], ["email", "text"], ["name", "text"], ["plan", "text"],
      ["mrr_cents", "integer"], ["created_at", "timestamptz"],
    ]),
    gnode("products", "r", 1240, [
      ["id", "uuid", true], ["sku", "text"], ["name", "text"], ["price_cents", "integer"], ["active", "boolean"],
    ]),
    gnode("orders", "r", 391207, [
      ["id", "uuid", true], ["user_id", "uuid", false, true], ["product_id", "uuid", false, true],
      ["quantity", "integer"], ["total_cents", "integer"], ["status", "text"], ["created_at", "timestamptz"],
    ]),
    gnode("subscriptions", "r", 9210, [
      ["id", "uuid", true], ["user_id", "uuid", false, true], ["product_id", "uuid", false, true],
      ["interval", "text"], ["renews_at", "timestamptz"], ["canceled_at", "timestamptz"],
    ]),
    gnode("events", "p", 8120441, [
      ["id", "bigint", true], ["user_id", "uuid", false, true], ["name", "text"],
      ["props", "jsonb"], ["occurred_at", "timestamptz"],
    ]),
    gnode("daily_revenue", "m", 730, [
      ["day", "date", true], ["gross_cents", "bigint"], ["orders", "integer"],
    ]),
  ],
  edges: [
    { name: "orders_user_id_fkey", source: "orders", source_columns: ["user_id"], target: "users", target_columns: ["id"] },
    { name: "orders_product_id_fkey", source: "orders", source_columns: ["product_id"], target: "products", target_columns: ["id"] },
    { name: "subscriptions_user_id_fkey", source: "subscriptions", source_columns: ["user_id"], target: "users", target_columns: ["id"] },
    { name: "subscriptions_product_id_fkey", source: "subscriptions", source_columns: ["product_id"], target: "products", target_columns: ["id"] },
    { name: "events_user_id_fkey", source: "events", source_columns: ["user_id"], target: "users", target_columns: ["id"] },
  ],
};

const demoGraphAuth: SchemaGraph = {
  nodes: [
    gnode("sessions", "r", 18733, [
      ["id", "uuid", true], ["user_id", "uuid", false, true], ["token", "text"], ["expires_at", "timestamptz"],
    ]),
    gnode("api_keys", "r", 64, [
      ["id", "uuid", true], ["user_id", "uuid", false, true], ["label", "text"], ["last_used_at", "timestamptz"],
    ]),
  ],
  edges: [],
};

export function demoGraph(schema: string): SchemaGraph {
  return schema === "auth" ? demoGraphAuth : demoGraphPublic;
}

// Every FK in the demo, with the schema of each endpoint — the cross-schema
// sessions/api_keys → public.users edges aren't in either graph's `edges`.
const demoFks: { schema: string; table: string; columns: string[]; target_schema: string; target_table: string; target_columns: string[]; name: string }[] = [
  ...demoGraphPublic.edges.map((e) => ({
    name: e.name, schema: "public", table: e.source, columns: e.source_columns,
    target_schema: "public", target_table: e.target, target_columns: e.target_columns,
  })),
  { name: "sessions_user_id_fkey", schema: "auth", table: "sessions", columns: ["user_id"], target_schema: "public", target_table: "users", target_columns: ["id"] },
  { name: "api_keys_user_id_fkey", schema: "auth", table: "api_keys", columns: ["user_id"], target_schema: "public", target_table: "users", target_columns: ["id"] },
];

export function demoRelations(schema: string, table: string): TableRelations {
  const outgoing: FkRef[] = demoFks
    .filter((f) => f.schema === schema && f.table === table)
    .map((f) => ({ constraint: f.name, local_columns: f.columns, other_schema: f.target_schema, other_table: f.target_table, other_columns: f.target_columns }));
  const incoming: FkRef[] = demoFks
    .filter((f) => f.target_schema === schema && f.target_table === table)
    .map((f) => ({ constraint: f.name, local_columns: f.target_columns, other_schema: f.schema, other_table: f.table, other_columns: f.columns }));
  return { outgoing, incoming };
}

// EXPLAIN plan for browser dev: a hash join with a slow filtered seq scan.
export function demoPlan(analyze: boolean): string {
  const t = (ms: number, rows: number, loops = 1) =>
    analyze
      ? { "Actual Startup Time": ms * 0.1, "Actual Total Time": ms, "Actual Rows": rows, "Actual Loops": loops }
      : {};
  const plan = {
    "Node Type": "Hash Join", "Join Type": "Inner", "Startup Cost": 1840.0, "Total Cost": 5214.7,
    "Plan Rows": 9800, "Plan Width": 72, "Hash Cond": "(o.user_id = u.id)", ...t(183.4, 84210),
    Plans: [
      {
        "Node Type": "Seq Scan", "Relation Name": "orders", Alias: "o",
        "Startup Cost": 0.0, "Total Cost": 3120.5, "Plan Rows": 9800, "Plan Width": 40,
        Filter: "(status = 'paid'::text)", "Rows Removed by Filter": 306997, ...t(141.2, 84210),
      },
      {
        "Node Type": "Hash", "Startup Cost": 1238.1, "Total Cost": 1238.1,
        "Plan Rows": 48211, "Plan Width": 32, ...t(36.8, 48211),
        Plans: [
          {
            "Node Type": "Index Scan", "Relation Name": "users", "Index Name": "users_pkey",
            "Startup Cost": 0.42, "Total Cost": 1238.1, "Plan Rows": 48211, "Plan Width": 32, ...t(28.4, 48211),
          },
        ],
      },
    ],
  };
  return JSON.stringify(
    [{ Plan: plan, "Planning Time": 0.41, ...(analyze ? { "Execution Time": 184.9, Triggers: [] } : {}) }],
    null,
    2
  );
}

export function demoSuggestion(question: string) {
  return {
    sql: `-- ${question}\nSELECT plan, count(*) AS users, sum(mrr_cents) / 100.0 AS mrr\nFROM public.users\nGROUP BY plan\nORDER BY mrr DESC\nLIMIT 500;`,
    explanation: "Counts users and sums MRR per plan, highest revenue first.",
  };
}

export function demoMonitor(): MonitorSnapshot {
  const t = Date.now();
  const wobble = Math.floor((t / 5000) % 12);
  return {
    sampled_at_ms: t,
    overview: {
      database: "analytics",
      server_version: "16.4",
      size_bytes: 3_428_920_320,
      uptime_seconds: 86400 * 12 + 3912,
      max_connections: 100,
      total_connections: 18 + (wobble % 3),
      active_connections: 3 + (wobble % 2),
      idle_in_transaction: wobble % 5 === 0 ? 1 : 0,
      waiting_connections: 0,
      xact_commit: 4_812_331 + wobble * 41,
      xact_rollback: 18_204 + wobble,
      blks_read: 912_500,
      blks_hit: 122_808_400 + wobble * 1500,
      cache_hit_pct: 99.26,
      deadlocks: 0,
      temp_bytes: 641_728_512,
      stats_reset: "2026-06-01 09:12:43+00",
    },
    activity: [
      {
        pid: 42120,
        user: "app_ro",
        application: "Strata",
        client: "127.0.0.1",
        state: "active",
        wait: "",
        duration_seconds: 2 + wobble,
        query: "SELECT date_trunc('day', occurred_at), count(*) FROM public.events GROUP BY 1 ORDER BY 1 DESC",
      },
      {
        pid: 42114,
        user: "worker",
        application: "sidekiq",
        client: "10.0.2.18",
        state: "idle",
        wait: "Client: ClientRead",
        duration_seconds: 48,
        query: "COMMIT",
      },
      {
        pid: 42103,
        user: "postgres",
        application: "psql",
        client: "127.0.0.1",
        state: "idle in transaction",
        wait: "Client: ClientRead",
        duration_seconds: 312,
        query: "UPDATE subscriptions SET plan = 'team' WHERE id = $1",
      },
    ],
    locks: [],
    tables: [
      { schema: "public", table: "events", size_bytes: 2_147_483_648, live_rows: 8_120_441, dead_rows: 129_310, seq_scan: 491, idx_scan: 2_812_004, last_vacuum: "2026-06-11 02:04:12+00", last_analyze: "2026-06-11 06:19:53+00" },
      { schema: "public", table: "orders", size_bytes: 148_897_792, live_rows: 391_207, dead_rows: 4_218, seq_scan: 89, idx_scan: 881_042, last_vacuum: "2026-06-11 01:20:40+00", last_analyze: "2026-06-11 05:40:07+00" },
      { schema: "public", table: "users", size_bytes: 18_874_368, live_rows: 48_211, dead_rows: 203, seq_scan: 31, idx_scan: 109_804, last_vacuum: "2026-06-10 23:05:11+00", last_analyze: "2026-06-11 04:02:31+00" },
      { schema: "auth", table: "sessions", size_bytes: 9_437_184, live_rows: 18_733, dead_rows: 2_104, seq_scan: 22, idx_scan: 55_019, last_vacuum: "2026-06-11 03:42:02+00", last_analyze: "2026-06-11 03:44:16+00" },
    ],
    statements_available: true,
    statements_error: null,
    statements: [
      { query: "SELECT * FROM public.orders WHERE status = $1 ORDER BY created_at DESC LIMIT $2", calls: 1284, total_ms: 48291.4, mean_ms: 37.61, rows: 128400 },
      { query: "INSERT INTO public.events (user_id, name, props, occurred_at) VALUES ($1, $2, $3, now())", calls: 91822, total_ms: 33981.9, mean_ms: 0.37, rows: 91822 },
      { query: "SELECT count(*) FROM public.users WHERE plan = $1", calls: 342, total_ms: 18412.2, mean_ms: 53.84, rows: 342 },
    ],
  };
}

export function wait<T>(data: T, ms = 350): Promise<T> {
  return new Promise((res) => setTimeout(() => res(data), ms));
}
