use serde::{Deserialize, Serialize};

/// A saved Postgres connection. Stored (password included) in settings.json
/// under the OS app-data dir — same plaintext-JSON approach as Sentinel's
/// integration credentials; the file is user-owned and not world-readable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    /// prefer | require | disable
    pub ssl_mode: String,
    /// accent hex used for the connection glyph
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub connections: Vec<ConnectionProfile>,
    pub row_limit: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            connections: vec![],
            row_limit: 200,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DbInfo {
    pub id: String,
    pub version: String,
    pub database: String,
    pub user: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchemaInfo {
    pub name: String,
    pub tables: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableInfo {
    pub name: String,
    /// r = table, p = partitioned table, v = view, m = matview, f = foreign
    pub kind: String,
    /// planner estimate; -1 when the table has never been analyzed
    pub est_rows: i64,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_pk: bool,
    pub default: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Filter {
    pub column: String,
    /// eq | neq | contains | gt | gte | lt | lte | null | notnull
    pub op: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiStatus {
    pub available: bool,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub affected: Option<u64>,
    pub elapsed_ms: u64,
    pub truncated: bool,
}
