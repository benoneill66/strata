use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;
use tokio_postgres::{Client, Config, NoTls, SimpleQueryMessage};

use crate::models::{ConnectionProfile, Filter, QueryResult};

/// Live connections keyed by profile id. Dropping a Client closes the
/// connection task spawned in `open`.
pub struct Pool {
    pub clients: tokio::sync::Mutex<HashMap<String, Arc<Client>>>,
}

impl Pool {
    pub fn new() -> Self {
        Self {
            clients: tokio::sync::Mutex::new(HashMap::new()),
        }
    }
}

fn config_for(p: &ConnectionProfile) -> Config {
    let mut cfg = Config::new();
    cfg.host(&p.host)
        .port(p.port)
        .user(&p.user)
        .dbname(&p.database)
        .application_name("Strata")
        .connect_timeout(Duration::from_secs(8));
    if !p.password.is_empty() {
        cfg.password(&p.password);
    }
    cfg
}

pub async fn open(p: &ConnectionProfile) -> Result<Client, String> {
    let cfg = config_for(p);
    match p.ssl_mode.as_str() {
        "disable" => connect_plain(&cfg).await,
        "require" => connect_tls(&cfg).await,
        // prefer: try TLS, fall back to plaintext (local dev servers)
        _ => match connect_tls(&cfg).await {
            Ok(c) => Ok(c),
            Err(_) => connect_plain(&cfg).await,
        },
    }
}

async fn connect_plain(cfg: &Config) -> Result<Client, String> {
    let (client, conn) = cfg.connect(NoTls).await.map_err(err_str)?;
    tokio::spawn(async move {
        let _ = conn.await;
    });
    Ok(client)
}

async fn connect_tls(cfg: &Config) -> Result<Client, String> {
    // No cert verification, like pgAdmin's default sslmode: encrypts the
    // wire (RDS etc.) without requiring a CA bundle on the machine.
    let tls = TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| e.to_string())?;
    let (client, conn) = cfg.connect(MakeTlsConnector::new(tls)).await.map_err(err_str)?;
    tokio::spawn(async move {
        let _ = conn.await;
    });
    Ok(client)
}

fn err_str(e: tokio_postgres::Error) -> String {
    match e.as_db_error() {
        Some(db) => db.message().to_string(),
        None => e.to_string(),
    }
}

pub fn quote_ident(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

pub fn quote_lit(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Run SQL over the simple-query protocol: every value comes back as text,
/// so arbitrary column types render without per-type decoding. Also handles
/// multi-statement scripts from the editor.
pub async fn simple(client: &Client, sql: &str, max_rows: usize) -> Result<QueryResult, String> {
    let started = Instant::now();
    let messages = client.simple_query(sql).await.map_err(err_str)?;
    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut affected: Option<u64> = None;
    let mut truncated = false;
    for m in messages {
        match m {
            SimpleQueryMessage::Row(r) => {
                if columns.is_empty() {
                    columns = r.columns().iter().map(|c| c.name().to_string()).collect();
                }
                if rows.len() >= max_rows {
                    truncated = true;
                    continue;
                }
                rows.push((0..r.len()).map(|i| r.get(i).map(|s| s.to_string())).collect());
            }
            SimpleQueryMessage::CommandComplete(n) => {
                if affected.is_none() {
                    affected = Some(n);
                }
            }
            _ => {}
        }
    }
    Ok(QueryResult {
        columns,
        rows,
        affected,
        elapsed_ms: started.elapsed().as_millis() as u64,
        truncated,
    })
}

/// Build a WHERE clause from grid filters. Identifiers are quoted and values
/// escaped as literals (simple protocol has no parameter binding). `eq`/`neq`
/// compare on the text form so they work for uuid/json/etc.; range ops leave
/// the column untouched so numeric and date comparisons stay typed.
pub fn filter_sql(filters: &[Filter]) -> Result<String, String> {
    if filters.is_empty() {
        return Ok(String::new());
    }
    let mut parts = Vec::new();
    for f in filters {
        let col = quote_ident(&f.column);
        let clause = match f.op.as_str() {
            "eq" => format!("{col}::text = {}", quote_lit(&f.value)),
            "neq" => format!("{col}::text <> {}", quote_lit(&f.value)),
            "contains" => format!("{col}::text ILIKE {}", quote_lit(&format!("%{}%", f.value))),
            "gt" => format!("{col} > {}", quote_lit(&f.value)),
            "gte" => format!("{col} >= {}", quote_lit(&f.value)),
            "lt" => format!("{col} < {}", quote_lit(&f.value)),
            "lte" => format!("{col} <= {}", quote_lit(&f.value)),
            "null" => format!("{col} IS NULL"),
            "notnull" => format!("{col} IS NOT NULL"),
            other => return Err(format!("unsupported filter op: {other}")),
        };
        parts.push(clause);
    }
    Ok(format!(" WHERE {}", parts.join(" AND ")))
}
