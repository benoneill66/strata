use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::RwLock;
use tauri::State;
use tokio_postgres::Client;

use crate::ai::{self, SqlSuggestion};
use crate::models::{AiStatus, ColumnInfo, ConnectionProfile, DbInfo, Filter, QueryResult, SchemaInfo, Settings, TableInfo};
use crate::pg::{self, Pool};

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

// ---------- settings ----------

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.settings.read().clone()
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> R<()> {
    {
        *state.settings.write() = settings.clone();
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&state.settings_path, json).map_err(|e| e.to_string())
}

// ---------- connection lifecycle ----------

#[tauri::command]
pub async fn test_connection(profile: ConnectionProfile) -> R<String> {
    let client = pg::open(&profile).await?;
    let res = pg::simple(&client, "SELECT version()", 1).await?;
    Ok(res
        .rows
        .first()
        .map(|r| cell(r, 0))
        .unwrap_or_default())
}

fn profile_for(state: &State<'_, AppState>, id: &str) -> R<ConnectionProfile> {
    state
        .settings
        .read()
        .connections
        .iter()
        .find(|c| c.id == id)
        .cloned()
        .ok_or_else(|| "connection not found".to_string())
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

// ---------- AI ----------

/// Compact schema dump for the AI prompt: one `schema.table(col type, …)` line
/// per relation across user schemas, capped so the prompt stays bounded on huge
/// databases. A trailing note records truncation.
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
        let key = format!("{}.{}", cell(r, 0), cell(r, 1));
        if key != cur {
            flush(&mut out, &cur, &cols, &mut truncated);
            cur = key;
            cols.clear();
        }
        cols.push(format!("{} {}", cell(r, 2), cell(r, 3)));
    }
    flush(&mut out, &cur, &cols, &mut truncated);
    if out.is_empty() {
        out.push_str("(no user tables found)\n");
    }
    Ok((out, truncated))
}

#[tauri::command]
pub fn ai_status() -> AiStatus {
    let (available, path) = ai::cli_status();
    AiStatus { available, path }
}

#[tauri::command]
pub async fn generate_sql(state: State<'_, AppState>, id: String, question: String) -> R<SqlSuggestion> {
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
    ai::generate_sql(&version, &db, &ctx, &question).await
}
