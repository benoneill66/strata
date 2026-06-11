// Fictional data for browser dev (bun run dev) — lets the UI render without
// the Tauri backend or a real database, and keeps screenshots clean.

import type { ColumnInfo, ConnectionProfile, Filter, QueryResult, SchemaInfo, TableInfo } from "./types";

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

export function demoSuggestion(question: string) {
  return {
    sql: `-- ${question}\nSELECT plan, count(*) AS users, sum(mrr_cents) / 100.0 AS mrr\nFROM public.users\nGROUP BY plan\nORDER BY mrr DESC\nLIMIT 500;`,
    explanation: "Counts users and sums MRR per plan, highest revenue first.",
  };
}

export function wait<T>(data: T, ms = 350): Promise<T> {
  return new Promise((res) => setTimeout(() => res(data), ms));
}
