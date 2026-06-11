use serde::{Deserialize, Serialize};

/// A saved Postgres connection. Profile fields persist to settings.json under
/// the OS app-data dir; the password lives in the macOS Keychain (see
/// `secrets`) and is blank in the file — it's hydrated at startup and carried
/// in memory only.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(default)]
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

/// A relation with its schema, across the whole database — powers the ⌘K
/// command palette's table jump.
#[derive(Debug, Clone, Serialize)]
pub struct QualifiedTable {
    pub schema: String,
    pub name: String,
    pub kind: String,
    pub est_rows: i64,
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

/// One column/value pair in a row mutation. `None` means SQL NULL — both as a
/// value to write and as a key to match (`IS NULL`).
#[derive(Debug, Clone, Deserialize)]
pub struct CellValue {
    pub column: String,
    pub value: Option<String>,
}

/// One row's worth of staged edits: the primary-key values that address the
/// row and the column changes to apply to it.
#[derive(Debug, Clone, Deserialize)]
pub struct RowUpdate {
    pub keys: Vec<CellValue>,
    pub changes: Vec<CellValue>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiStatus {
    pub available: bool,
    pub path: String,
}

// ---------- schema graph (ER diagram) ----------

#[derive(Debug, Clone, Serialize)]
pub struct GraphColumn {
    pub name: String,
    pub data_type: String,
    pub is_pk: bool,
    pub is_fk: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphNode {
    pub name: String,
    /// r = table, p = partitioned, v = view, m = matview, f = foreign
    pub kind: String,
    pub est_rows: i64,
    pub columns: Vec<GraphColumn>,
}

/// A foreign-key relationship between two relations in the same schema.
#[derive(Debug, Clone, Serialize)]
pub struct GraphEdge {
    pub name: String,
    pub source: String,
    pub source_columns: Vec<String>,
    pub target: String,
    pub target_columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchemaGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub affected: Option<u64>,
    pub elapsed_ms: u64,
    pub truncated: bool,
}
