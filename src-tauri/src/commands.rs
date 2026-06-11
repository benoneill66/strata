use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::RwLock;
use tauri::State;
use tokio_postgres::Client;

use crate::ai::{self, SqlSuggestion};
use crate::export;
use crate::models::{
    AiProvider, AiStatus, CellValue, ColumnInfo, ConnectionProfile, DbInfo, Filter, FkRef, GraphColumn,
    GraphEdge, GraphNode, MonitorActivity, MonitorLock, MonitorOverview, MonitorSnapshot,
    MonitorStatement, MonitorTableHealth, QualifiedTable, QueryResult, RowUpdate, SchemaGraph,
    SchemaInfo, Settings, TableInfo, TableRelations,
};
use crate::pg::{self, Pool};
use crate::secrets;

pub struct AppState {
    pub settings: RwLock<Settings>,
    pub settings_path: PathBuf,
    pub pool: Pool,
}

type R<T> = Result<T, String>;

const HIDDEN_SCHEMAS: &str =
    "n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'";

fn cell(row: &[Option<String>], i: usize) -> String {
    row.get(i).cloned().flatten().unwrap_or_default()
}

fn opt_cell(row: &[Option<String>], i: usize) -> Option<String> {
    row.get(i).cloned().flatten()
}

fn i64_cell(row: &[Option<String>], i: usize) -> i64 {
    cell(row, i).parse().unwrap_or(0)
}

fn f64_cell(row: &[Option<String>], i: usize) -> f64 {
    cell(row, i).parse().unwrap_or(0.0)
}

fn sampled_at_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn quote_ident_if_needed(name: &str) -> String {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return "\"\"".to_string();
    };
    let simple_start = first == '_' || first.is_ascii_lowercase();
    let simple_rest = chars.all(|c| c == '_' || c == '$' || c.is_ascii_lowercase() || c.is_ascii_digit());
    if simple_start && simple_rest {
        name.to_string()
    } else {
        format!("\"{}\"", name.replace('"', "\"\""))
    }
}

async fn client_for(state: &State<'_, AppState>, id: &str) -> R<Arc<Client>> {
    state
        .pool
        .clients
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or_else(|| "Not connected — open the connection first.".to_string())
}

fn selected_ai_provider(state: &State<'_, AppState>) -> AiProvider {
    state.settings.read().ai_provider
}

// ---------- settings ----------

fn strip_passwords(mut settings: Settings) -> Settings {
    for c in &mut settings.connections {
        c.password.clear();
    }
    settings
}

fn hydrate_password(profile: &mut ConnectionProfile) {
    if profile.password.is_empty() {
        if let Some(password) = secrets::get(&profile.id) {
            profile.password = password;
        }
    }
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    strip_passwords(state.settings.read().clone())
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> R<()> {
    // Non-empty passwords go to the Keychain. Empty passwords mean "leave any
    // existing secret alone" because saved profiles are normally passwordless
    // in memory and on disk.
    for c in &settings.connections {
        if !c.password.is_empty() {
            secrets::set(&c.id, &c.password)?;
        }
    }
    let removed: Vec<String> = state
        .settings
        .read()
        .connections
        .iter()
        .filter(|old| !settings.connections.iter().any(|c| c.id == old.id))
        .map(|old| old.id.clone())
        .collect();
    for id in removed {
        secrets::delete(&id);
    }
    let on_disk = strip_passwords(settings);
    {
        *state.settings.write() = on_disk.clone();
    }
    let json = serde_json::to_string_pretty(&on_disk).map_err(|e| e.to_string())?;
    std::fs::write(&state.settings_path, json).map_err(|e| e.to_string())
}

// ---------- connection lifecycle ----------

#[tauri::command]
pub async fn test_connection(state: State<'_, AppState>, mut profile: ConnectionProfile) -> R<String> {
    if state
        .settings
        .read()
        .connections
        .iter()
        .any(|c| c.id == profile.id)
    {
        hydrate_password(&mut profile);
    }
    let client = pg::open(&profile).await?;
    let res = pg::simple(&client, "SELECT version()", 1).await?;
    Ok(res
        .rows
        .first()
        .map(|r| cell(r, 0))
        .unwrap_or_default())
}

fn profile_for(state: &State<'_, AppState>, id: &str) -> R<ConnectionProfile> {
    let mut profile = state
        .settings
        .read()
        .connections
        .iter()
        .find(|c| c.id == id)
        .cloned()
        .ok_or_else(|| "connection not found".to_string())?;
    hydrate_password(&mut profile);
    Ok(profile)
}

/// Open a client and read its identity in one round-trip. The caller pools it.
async fn open_and_info(profile: &ConnectionProfile, id: &str) -> R<(tokio_postgres::Client, DbInfo)> {
    let client = pg::open(profile).await?;
    let res = pg::simple(
        &client,
        "SELECT current_setting('server_version'), current_database(), current_user",
        1,
    )
    .await?;
    let row = res.rows.first().ok_or("no response from server")?;
    let info = DbInfo {
        id: id.to_string(),
        version: cell(row, 0),
        database: cell(row, 1),
        user: cell(row, 2),
    };
    Ok((client, info))
}

#[tauri::command]
pub async fn connect_db(state: State<'_, AppState>, id: String) -> R<DbInfo> {
    let profile = profile_for(&state, &id)?;
    let (client, info) = open_and_info(&profile, &id).await?;
    state.pool.clients.lock().await.insert(id, Arc::new(client));
    Ok(info)
}

/// Connect to a different database on the same server. Postgres connections are
/// per-database, so this opens a fresh client (reusing the profile's host/auth)
/// and swaps it into the pool only if it opens cleanly — a failed switch leaves
/// the current connection untouched.
#[tauri::command]
pub async fn switch_database(state: State<'_, AppState>, id: String, database: String) -> R<DbInfo> {
    let mut profile = profile_for(&state, &id)?;
    profile.database = database;
    let (client, info) = open_and_info(&profile, &id).await?;
    state.pool.clients.lock().await.insert(id, Arc::new(client));
    Ok(info)
}

#[tauri::command]
pub async fn list_databases(state: State<'_, AppState>, id: String) -> R<Vec<String>> {
    let client = client_for(&state, &id).await?;
    let res = pg::simple(
        &client,
        "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname",
        10_000,
    )
    .await?;
    Ok(res.rows.iter().map(|r| cell(r, 0)).collect())
}

#[tauri::command]
pub async fn disconnect_db(state: State<'_, AppState>, id: String) -> R<()> {
    state.pool.clients.lock().await.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn connected_ids(state: State<'_, AppState>) -> R<Vec<String>> {
    Ok(state.pool.clients.lock().await.keys().cloned().collect())
}

// ---------- catalog ----------

#[tauri::command]
pub async fn list_schemas(state: State<'_, AppState>, id: String) -> R<Vec<SchemaInfo>> {
    let client = client_for(&state, &id).await?;
    let sql = format!(
        "SELECT n.nspname, count(c.oid) FILTER (WHERE c.relkind IN ('r','p','v','m','f')) \
         FROM pg_namespace n \
         LEFT JOIN pg_class c ON c.relnamespace = n.oid \
         WHERE {HIDDEN_SCHEMAS} \
         GROUP BY n.nspname ORDER BY n.nspname"
    );
    let res = pg::simple(&client, &sql, 10_000).await?;
    Ok(res
        .rows
        .iter()
        .map(|r| SchemaInfo {
            name: cell(r, 0),
            tables: cell(r, 1).parse().unwrap_or(0),
        })
        .collect())
}

#[tauri::command]
pub async fn list_tables(state: State<'_, AppState>, id: String, schema: String) -> R<Vec<TableInfo>> {
    let client = client_for(&state, &id).await?;
    let sql = format!(
        "SELECT c.relname, c.relkind::text, c.reltuples::bigint, pg_total_relation_size(c.oid) \
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = {} AND c.relkind IN ('r','p','v','m','f') \
         ORDER BY c.relname",
        pg::quote_lit(&schema)
    );
    let res = pg::simple(&client, &sql, 50_000).await?;
    Ok(res
        .rows
        .iter()
        .map(|r| TableInfo {
            name: cell(r, 0),
            kind: cell(r, 1),
            est_rows: cell(r, 2).parse().unwrap_or(-1),
            size_bytes: cell(r, 3).parse().unwrap_or(0),
        })
        .collect())
}

/// Every relation in every user schema, one round-trip — the ⌘K palette
/// searches this to jump anywhere in the database.
#[tauri::command]
pub async fn list_all_tables(state: State<'_, AppState>, id: String) -> R<Vec<QualifiedTable>> {
    let client = client_for(&state, &id).await?;
    let sql = format!(
        "SELECT n.nspname, c.relname, c.relkind::text, c.reltuples::bigint \
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE {HIDDEN_SCHEMAS} AND c.relkind IN ('r','p','v','m','f') \
         ORDER BY n.nspname, c.relname"
    );
    let res = pg::simple(&client, &sql, 50_000).await?;
    Ok(res
        .rows
        .iter()
        .map(|r| QualifiedTable {
            schema: cell(r, 0),
            name: cell(r, 1),
            kind: cell(r, 2),
            est_rows: cell(r, 3).parse().unwrap_or(-1),
        })
        .collect())
}

#[tauri::command]
pub async fn table_columns(
    state: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
) -> R<Vec<ColumnInfo>> {
    let client = client_for(&state, &id).await?;
    let sql = format!(
        "SELECT a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull, \
                COALESCE((SELECT true FROM pg_index i \
                          WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey)), false), \
                pg_get_expr(d.adbin, d.adrelid) \
         FROM pg_attribute a \
         JOIN pg_class c ON c.oid = a.attrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
         WHERE n.nspname = {} AND c.relname = {} AND a.attnum > 0 AND NOT a.attisdropped \
         ORDER BY a.attnum",
        pg::quote_lit(&schema),
        pg::quote_lit(&table)
    );
    let res = pg::simple(&client, &sql, 5_000).await?;
    Ok(res
        .rows
        .iter()
        .map(|r| ColumnInfo {
            name: cell(r, 0),
            data_type: cell(r, 1),
            nullable: cell(r, 2) == "t",
            is_pk: cell(r, 3) == "t",
            default: r.get(4).cloned().flatten(),
        })
        .collect())
}

/// Build the whole picture of a schema in one shot: every relation, its columns
/// (with PK/FK markers) and the foreign-key edges between them. Powers the
/// interactive ER diagram. Edges are limited to FKs whose both ends live in the
/// selected schema, so the graph stays self-contained.
#[tauri::command]
pub async fn schema_graph(state: State<'_, AppState>, id: String, schema: String) -> R<SchemaGraph> {
    let client = client_for(&state, &id).await?;
    let lit = pg::quote_lit(&schema);

    // relations (preserve order; index by name for column/edge attachment)
    let tables_sql = format!(
        "SELECT c.relname, c.relkind::text, c.reltuples::bigint \
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = {lit} AND c.relkind IN ('r','p','v','m','f') \
         ORDER BY c.relname"
    );
    let tables = pg::simple(&client, &tables_sql, 50_000).await?;
    let mut nodes: Vec<GraphNode> = Vec::with_capacity(tables.rows.len());
    let mut index: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for r in &tables.rows {
        let name = cell(r, 0);
        index.insert(name.clone(), nodes.len());
        nodes.push(GraphNode {
            name,
            kind: cell(r, 1),
            est_rows: cell(r, 2).parse().unwrap_or(-1),
            columns: Vec::new(),
        });
    }

    // columns for every relation in the schema
    let cols_sql = format!(
        "SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod), \
                COALESCE((SELECT true FROM pg_index i \
                          WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey)), false) \
         FROM pg_attribute a \
         JOIN pg_class c ON c.oid = a.attrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = {lit} AND c.relkind IN ('r','p','v','m','f') \
                AND a.attnum > 0 AND NOT a.attisdropped \
         ORDER BY c.relname, a.attnum"
    );
    let cols = pg::simple(&client, &cols_sql, 200_000).await?;
    for r in &cols.rows {
        if let Some(&i) = index.get(&cell(r, 0)) {
            nodes[i].columns.push(GraphColumn {
                name: cell(r, 1),
                data_type: cell(r, 2),
                is_pk: cell(r, 3) == "t",
                is_fk: false,
            });
        }
    }

    // foreign-key edges (both endpoints in this schema)
    let edges_sql = format!(
        "SELECT con.conname, src.relname, tgt.relname, \
                (SELECT string_agg(a.attname, ',' ORDER BY k.ord) \
                   FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) \
                   JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum), \
                (SELECT string_agg(a.attname, ',' ORDER BY k.ord) \
                   FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord) \
                   JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) \
         FROM pg_constraint con \
         JOIN pg_class src ON src.oid = con.conrelid \
         JOIN pg_namespace sn ON sn.oid = src.relnamespace \
         JOIN pg_class tgt ON tgt.oid = con.confrelid \
         JOIN pg_namespace tn ON tn.oid = tgt.relnamespace \
         WHERE con.contype = 'f' AND sn.nspname = {lit} AND tn.nspname = {lit} \
         ORDER BY con.conname"
    );
    let edges_res = pg::simple(&client, &edges_sql, 50_000).await?;
    let split = |s: String| s.split(',').map(|p| p.to_string()).collect::<Vec<_>>();
    let mut edges: Vec<GraphEdge> = Vec::with_capacity(edges_res.rows.len());
    for r in &edges_res.rows {
        let source = cell(r, 1);
        let source_columns = split(cell(r, 3));
        // mark the source columns as FKs on their node
        if let Some(&i) = index.get(&source) {
            for c in &mut nodes[i].columns {
                if source_columns.contains(&c.name) {
                    c.is_fk = true;
                }
            }
        }
        edges.push(GraphEdge {
            name: cell(r, 0),
            source,
            source_columns,
            target: cell(r, 2),
            target_columns: split(cell(r, 4)),
        });
    }

    Ok(SchemaGraph { nodes, edges })
}

/// Foreign keys touching one table, oriented for navigation: the FKs declared
/// on it (outgoing → parent rows) and the FKs on other tables that point at it
/// (incoming → child rows). Unlike `schema_graph` this follows edges across
/// schemas, since a lookup can point anywhere. Powers click-through in Browse.
#[tauri::command]
pub async fn table_relations(
    state: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
) -> R<TableRelations> {
    let client = client_for(&state, &id).await?;
    let s = pg::quote_lit(&schema);
    let t = pg::quote_lit(&table);

    // Column lists for both ends of every FK constraint, with the parent side's
    // namespace so cross-schema jumps land in the right schema. `local`/`other`
    // are assigned per direction below.
    let query = |where_clause: &str| {
        format!(
            "SELECT con.conname, cn.nspname, child.relname, pn.nspname, parent.relname, \
                    (SELECT string_agg(a.attname, ',' ORDER BY k.ord) \
                       FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) \
                       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum), \
                    (SELECT string_agg(a.attname, ',' ORDER BY k.ord) \
                       FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord) \
                       JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) \
             FROM pg_constraint con \
             JOIN pg_class child ON child.oid = con.conrelid \
             JOIN pg_namespace cn ON cn.oid = child.relnamespace \
             JOIN pg_class parent ON parent.oid = con.confrelid \
             JOIN pg_namespace pn ON pn.oid = parent.relnamespace \
             WHERE con.contype = 'f' AND {where_clause} \
             ORDER BY con.conname"
        )
    };
    let split = |s: String| s.split(',').map(|p| p.to_string()).collect::<Vec<_>>();

    // Outgoing: this table is the child (conrelid). local = child cols (conkey),
    // other = parent cols (confkey) on parent relation.
    let out_sql = query(&format!("cn.nspname = {s} AND child.relname = {t}"));
    let out_res = pg::simple(&client, &out_sql, 5_000).await?;
    let outgoing = out_res
        .rows
        .iter()
        .map(|r| FkRef {
            constraint: cell(r, 0),
            local_columns: split(cell(r, 5)),
            other_schema: cell(r, 3),
            other_table: cell(r, 4),
            other_columns: split(cell(r, 6)),
        })
        .collect();

    // Incoming: this table is the parent (confrelid). local = parent cols
    // (confkey), other = the child's FK cols (conkey) on the child relation.
    let in_sql = query(&format!("pn.nspname = {s} AND parent.relname = {t}"));
    let in_res = pg::simple(&client, &in_sql, 5_000).await?;
    let incoming = in_res
        .rows
        .iter()
        .map(|r| FkRef {
            constraint: cell(r, 0),
            local_columns: split(cell(r, 6)),
            other_schema: cell(r, 1),
            other_table: cell(r, 2),
            other_columns: split(cell(r, 5)),
        })
        .collect();

    Ok(TableRelations { outgoing, incoming })
}

// ---------- monitor ----------

#[tauri::command]
pub async fn monitor_snapshot(state: State<'_, AppState>, id: String) -> R<MonitorSnapshot> {
    let client = client_for(&state, &id).await?;

    let overview_sql = "\
        SELECT current_database(), current_setting('server_version'), pg_database_size(current_database()), \
               EXTRACT(EPOCH FROM now() - pg_postmaster_start_time())::bigint, \
               current_setting('max_connections')::bigint, \
               (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()), \
               (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active'), \
               (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'), \
               (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type IS NOT NULL), \
               COALESCE(d.xact_commit, 0), COALESCE(d.xact_rollback, 0), \
               COALESCE(d.blks_read, 0), COALESCE(d.blks_hit, 0), \
               CASE WHEN COALESCE(d.blks_hit, 0) + COALESCE(d.blks_read, 0) = 0 THEN 0 \
                    ELSE round((d.blks_hit::numeric / (d.blks_hit + d.blks_read)) * 100, 2) END, \
               COALESCE(d.deadlocks, 0), COALESCE(d.temp_bytes, 0), d.stats_reset::text \
          FROM pg_stat_database d \
         WHERE d.datname = current_database()";
    let overview_res = pg::simple(&client, overview_sql, 1).await?;
    let overview_row = overview_res.rows.first().ok_or("database stats unavailable")?;
    let overview = MonitorOverview {
        database: cell(overview_row, 0),
        server_version: cell(overview_row, 1),
        size_bytes: i64_cell(overview_row, 2),
        uptime_seconds: i64_cell(overview_row, 3),
        max_connections: i64_cell(overview_row, 4),
        total_connections: i64_cell(overview_row, 5),
        active_connections: i64_cell(overview_row, 6),
        idle_in_transaction: i64_cell(overview_row, 7),
        waiting_connections: i64_cell(overview_row, 8),
        xact_commit: i64_cell(overview_row, 9),
        xact_rollback: i64_cell(overview_row, 10),
        blks_read: i64_cell(overview_row, 11),
        blks_hit: i64_cell(overview_row, 12),
        cache_hit_pct: f64_cell(overview_row, 13),
        deadlocks: i64_cell(overview_row, 14),
        temp_bytes: i64_cell(overview_row, 15),
        stats_reset: opt_cell(overview_row, 16),
    };

    let activity_sql = "\
        SELECT pid::bigint, usename, COALESCE(application_name, ''), COALESCE(client_addr::text, ''), \
               COALESCE(state, ''), COALESCE(wait_event_type || ': ' || wait_event, ''), \
               COALESCE(EXTRACT(EPOCH FROM now() - COALESCE(query_start, state_change))::bigint, 0), \
               left(COALESCE(query, ''), 700) \
          FROM pg_stat_activity \
         WHERE datname = current_database() AND pid <> pg_backend_pid() \
         ORDER BY CASE WHEN state = 'active' THEN 0 ELSE 1 END, query_start NULLS LAST \
         LIMIT 50";
    let activity_res = pg::simple(&client, activity_sql, 50).await?;
    let activity = activity_res
        .rows
        .iter()
        .map(|r| MonitorActivity {
            pid: i64_cell(r, 0),
            user: cell(r, 1),
            application: cell(r, 2),
            client: cell(r, 3),
            state: cell(r, 4),
            wait: cell(r, 5),
            duration_seconds: i64_cell(r, 6),
            query: cell(r, 7),
        })
        .collect();

    let locks_sql = "\
        SELECT blocked.pid::bigint, ba.usename, blocking.pid::bigint, blocked.locktype, blocked.mode, \
               COALESCE(n.nspname || '.' || c.relname, ''), \
               COALESCE(EXTRACT(EPOCH FROM now() - COALESCE(ba.query_start, ba.state_change))::bigint, 0), \
               left(COALESCE(ba.query, ''), 700), left(COALESCE(blockinga.query, ''), 700) \
          FROM pg_locks blocked \
          JOIN pg_stat_activity ba ON ba.pid = blocked.pid \
          JOIN pg_locks blocking ON blocking.locktype = blocked.locktype \
               AND blocking.database IS NOT DISTINCT FROM blocked.database \
               AND blocking.relation IS NOT DISTINCT FROM blocked.relation \
               AND blocking.page IS NOT DISTINCT FROM blocked.page \
               AND blocking.tuple IS NOT DISTINCT FROM blocked.tuple \
               AND blocking.virtualxid IS NOT DISTINCT FROM blocked.virtualxid \
               AND blocking.transactionid IS NOT DISTINCT FROM blocked.transactionid \
               AND blocking.classid IS NOT DISTINCT FROM blocked.classid \
               AND blocking.objid IS NOT DISTINCT FROM blocked.objid \
               AND blocking.objsubid IS NOT DISTINCT FROM blocked.objsubid \
               AND blocking.pid <> blocked.pid \
          JOIN pg_stat_activity blockinga ON blockinga.pid = blocking.pid \
          LEFT JOIN pg_class c ON c.oid = blocked.relation \
          LEFT JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE NOT blocked.granted AND blocking.granted AND ba.datname = current_database() \
         ORDER BY ba.query_start NULLS FIRST \
         LIMIT 50";
    let locks_res = pg::simple(&client, locks_sql, 50).await?;
    let locks = locks_res
        .rows
        .iter()
        .map(|r| MonitorLock {
            blocked_pid: i64_cell(r, 0),
            blocked_user: cell(r, 1),
            blocking_pid: i64_cell(r, 2),
            locktype: cell(r, 3),
            mode: cell(r, 4),
            relation: cell(r, 5),
            duration_seconds: i64_cell(r, 6),
            blocked_query: cell(r, 7),
            blocking_query: cell(r, 8),
        })
        .collect();

    let tables_sql = "\
        SELECT schemaname, relname, pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass), \
               COALESCE(n_live_tup, 0), COALESCE(n_dead_tup, 0), COALESCE(seq_scan, 0), COALESCE(idx_scan, 0), \
               COALESCE(last_autovacuum, last_vacuum)::text, COALESCE(last_autoanalyze, last_analyze)::text \
          FROM pg_stat_user_tables \
         ORDER BY pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass) DESC \
         LIMIT 20";
    let tables_res = pg::simple(&client, tables_sql, 20).await?;
    let tables = tables_res
        .rows
        .iter()
        .map(|r| MonitorTableHealth {
            schema: cell(r, 0),
            table: cell(r, 1),
            size_bytes: i64_cell(r, 2),
            live_rows: i64_cell(r, 3),
            dead_rows: i64_cell(r, 4),
            seq_scan: i64_cell(r, 5),
            idx_scan: i64_cell(r, 6),
            last_vacuum: opt_cell(r, 7),
            last_analyze: opt_cell(r, 8),
        })
        .collect();

    let mut statements_available = false;
    let mut statements_error = None;
    let mut statements = Vec::new();
    let statements_schema = pg::simple(
        &client,
        "SELECT n.nspname \
           FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace \
          WHERE e.extname = 'pg_stat_statements'",
        1,
    )
        .await
        .ok()
        .and_then(|res| res.rows.first().and_then(|r| opt_cell(r, 0)));
    if let Some(schema) = statements_schema {
        let target = format!("{}.{}", pg::quote_ident(&schema), pg::quote_ident("pg_stat_statements"));
        let statements_sql = format!(
            "\
            SELECT left(query, 700), calls::bigint, total_exec_time::double precision, \
                   mean_exec_time::double precision, rows::bigint \
              FROM {target} \
             WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) \
             ORDER BY total_exec_time DESC \
             LIMIT 10"
        );
        match pg::simple(&client, &statements_sql, 10).await {
            Ok(res) => {
                statements_available = true;
                statements = res
                    .rows
                    .iter()
                    .map(|r| MonitorStatement {
                        query: cell(r, 0),
                        calls: i64_cell(r, 1),
                        total_ms: f64_cell(r, 2),
                        mean_ms: f64_cell(r, 3),
                        rows: i64_cell(r, 4),
                    })
                    .collect();
            }
            Err(e) => statements_error = Some(e),
        }
    }

    Ok(MonitorSnapshot {
        sampled_at_ms: sampled_at_ms(),
        overview,
        activity,
        locks,
        tables,
        statements_available,
        statements_error,
        statements,
    })
}

// ---------- data ----------

#[tauri::command]
pub async fn table_rows(
    state: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
    limit: u32,
    offset: u64,
    order_by: Option<String>,
    order_desc: bool,
    filters: Vec<Filter>,
) -> R<QueryResult> {
    let client = client_for(&state, &id).await?;
    let mut sql = format!(
        "SELECT * FROM {}.{}",
        pg::quote_ident(&schema),
        pg::quote_ident(&table)
    );
    sql.push_str(&pg::filter_sql(&filters)?);
    if let Some(col) = &order_by {
        sql.push_str(&format!(
            " ORDER BY {} {}",
            pg::quote_ident(col),
            if order_desc { "DESC" } else { "ASC" }
        ));
    }
    let limit = limit.clamp(1, 5_000);
    sql.push_str(&format!(" LIMIT {limit} OFFSET {offset}"));
    pg::simple(&client, &sql, limit as usize).await
}

#[tauri::command]
pub async fn table_count(
    state: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
    filters: Vec<Filter>,
) -> R<i64> {
    let client = client_for(&state, &id).await?;
    let sql = format!(
        "SELECT count(*) FROM {}.{}{}",
        pg::quote_ident(&schema),
        pg::quote_ident(&table),
        pg::filter_sql(&filters)?
    );
    let res = pg::simple(&client, &sql, 1).await?;
    res.rows
        .first()
        .map(|r| cell(r, 0).parse().unwrap_or(0))
        .ok_or_else(|| "count failed".to_string())
}

// ---------- row mutations (inline editing) ----------

/// Apply a batch of staged edits, each row matched by its primary-key values
/// as displayed in the grid. One transaction: all rows save or none do.
#[tauri::command]
pub async fn update_rows(
    state: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
    updates: Vec<RowUpdate>,
) -> R<u64> {
    let client = client_for(&state, &id).await?;
    pg::apply_updates(&client, &schema, &table, &updates).await
}

#[tauri::command]
pub async fn insert_row(
    state: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
    values: Vec<CellValue>,
) -> R<u64> {
    let client = client_for(&state, &id).await?;
    let sql = pg::insert_sql(&schema, &table, &values);
    let res = pg::simple(&client, &sql, 1).await?;
    Ok(res.affected.unwrap_or(0))
}

#[tauri::command]
pub async fn delete_row(
    state: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
    keys: Vec<CellValue>,
) -> R<u64> {
    let client = client_for(&state, &id).await?;
    let sql = pg::delete_sql(&schema, &table, &keys)?;
    pg::exec_expect(&client, &sql, 1).await
}

#[tauri::command]
pub async fn run_query(
    state: State<'_, AppState>,
    id: String,
    sql: String,
    max_rows: u32,
) -> R<QueryResult> {
    let client = client_for(&state, &id).await?;
    pg::simple(&client, &sql, max_rows.clamp(1, 10_000) as usize).await
}

// ---------- export ----------

/// Export a Browse table to a file: rebuild the same `SELECT *` the grid uses
/// (filters + sort) but without the page limit, so the whole filtered result
/// lands on disk. Returns the number of rows written.
#[tauri::command]
pub async fn export_table(
    state: State<'_, AppState>,
    id: String,
    schema: String,
    table: String,
    order_by: Option<String>,
    order_desc: bool,
    filters: Vec<Filter>,
    format: String,
    path: String,
) -> R<u64> {
    let fmt = export::Format::parse(&format)?;
    let client = client_for(&state, &id).await?;
    let mut sql = format!(
        "SELECT * FROM {}.{}",
        pg::quote_ident(&schema),
        pg::quote_ident(&table)
    );
    sql.push_str(&pg::filter_sql(&filters)?);
    if let Some(col) = &order_by {
        sql.push_str(&format!(
            " ORDER BY {} {}",
            pg::quote_ident(col),
            if order_desc { "DESC" } else { "ASC" }
        ));
    }
    let res = pg::simple(&client, &sql, usize::MAX).await?;
    let target = format!("{}.{}", pg::quote_ident(&schema), pg::quote_ident(&table));
    let content = export::render(fmt, &res.columns, &res.rows, &target)?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(res.rows.len() as u64)
}

/// Export the results of an editor query to a file. The caller only enables
/// this for read-only SQL, so re-running it to fetch the full (uncapped) result
/// set has no side effects. Returns the number of rows written.
#[tauri::command]
pub async fn export_query(
    state: State<'_, AppState>,
    id: String,
    sql: String,
    format: String,
    path: String,
) -> R<u64> {
    let fmt = export::Format::parse(&format)?;
    let client = client_for(&state, &id).await?;
    let res = pg::simple(&client, &sql, usize::MAX).await?;
    let content = export::render(fmt, &res.columns, &res.rows, &pg::quote_ident("query_result"))?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(res.rows.len() as u64)
}

/// EXPLAIN the statement and return the plan JSON. With `analyze` the query
/// really executes (inside a transaction that always rolls back) to capture
/// actual timings.
#[tauri::command]
pub async fn explain_query(
    state: State<'_, AppState>,
    id: String,
    sql: String,
    analyze: bool,
) -> R<String> {
    let client = client_for(&state, &id).await?;
    pg::explain(&client, &sql, analyze).await
}

/// Feed a plan to the selected AI CLI for a short bottleneck diagnosis.
#[tauri::command]
pub async fn diagnose_plan(state: State<'_, AppState>, sql: String, plan: String) -> R<String> {
    let provider = selected_ai_provider(&state);
    ai::diagnose_plan(provider, &sql, &plan).await
}

// ---------- AI ----------

/// Compact schema dump for the AI prompt: one `schema.table(col type, …)` line
/// per relation across user schemas, capped so the prompt stays bounded on huge
/// databases. Identifiers that PostgreSQL would fold or reject unquoted are
/// rendered with quotes so the model can copy exact casing.
async fn schema_context(client: &tokio_postgres::Client) -> R<(String, bool)> {
    const MAX_CHARS: usize = 24_000;
    let sql = format!(
        "SELECT n.nspname, c.relname, a.attname, format_type(a.atttypid, a.atttypmod) \
         FROM pg_class c \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         JOIN pg_attribute a ON a.attrelid = c.oid \
         WHERE {HIDDEN_SCHEMAS} AND c.relkind IN ('r','p','v','m','f') \
                AND a.attnum > 0 AND NOT a.attisdropped \
         ORDER BY n.nspname, c.relname, a.attnum"
    );
    let res = pg::simple(client, &sql, 200_000).await?;

    // group consecutive rows by (schema, table)
    let mut out = String::new();
    let mut truncated = false;
    let mut cur = String::new(); // "schema.table"
    let mut cols: Vec<String> = Vec::new();
    let flush = |out: &mut String, cur: &str, cols: &[String], truncated: &mut bool| {
        if cur.is_empty() || *truncated {
            return;
        }
        let line = format!("{cur}({})\n", cols.join(", "));
        if out.len() + line.len() > MAX_CHARS {
            *truncated = true;
            return;
        }
        out.push_str(&line);
    };
    for r in &res.rows {
        let key = format!(
            "{}.{}",
            quote_ident_if_needed(&cell(r, 0)),
            quote_ident_if_needed(&cell(r, 1))
        );
        if key != cur {
            flush(&mut out, &cur, &cols, &mut truncated);
            cur = key;
            cols.clear();
        }
        cols.push(format!("{} {}", quote_ident_if_needed(&cell(r, 2)), cell(r, 3)));
    }
    flush(&mut out, &cur, &cols, &mut truncated);
    if out.is_empty() {
        out.push_str("(no user tables found)\n");
    }
    Ok((out, truncated))
}

#[tauri::command]
pub fn ai_status(state: State<AppState>) -> AiStatus {
    let provider = selected_ai_provider(&state);
    let (available, path) = ai::cli_status(provider);
    let (model, effort) = ai::cli_config(provider);
    let (claude_path, codex_path) = ai::provider_paths();
    AiStatus {
        provider,
        available,
        path,
        model: model.to_string(),
        effort: effort.to_string(),
        claude_path,
        codex_path,
    }
}

#[tauri::command]
pub async fn generate_sql(state: State<'_, AppState>, id: String, question: String) -> R<SqlSuggestion> {
    let provider = selected_ai_provider(&state);
    let client = client_for(&state, &id).await?;
    let info = pg::simple(
        &client,
        "SELECT current_setting('server_version'), current_database()",
        1,
    )
    .await?;
    let row = info.rows.first().ok_or("no response from server")?;
    let version = cell(row, 0);
    let db = cell(row, 1);
    let (mut ctx, truncated) = schema_context(&client).await?;
    if truncated {
        ctx.push_str("… (schema truncated; ask about a specific table if your target is missing)\n");
    }
    ai::generate_sql(provider, &version, &db, &ctx, &question).await
}

#[cfg(test)]
mod tests {
    use super::quote_ident_if_needed;

    #[test]
    fn quotes_identifiers_that_postgres_would_fold() {
        assert_eq!(quote_ident_if_needed("created_at"), "created_at");
        assert_eq!(quote_ident_if_needed("dateOfBirth"), "\"dateOfBirth\"");
        assert_eq!(quote_ident_if_needed("User"), "\"User\"");
        assert_eq!(quote_ident_if_needed("display name"), "\"display name\"");
        assert_eq!(quote_ident_if_needed("has\"quote"), "\"has\"\"quote\"");
    }
}
