//! Follow incoming foreign keys from a seed row to collect every descendant
//! row — the data that (transitively) belongs to one record. Powers the
//! "export related" feature: pick a user, pull their whole subtree to CSV.
//!
//! Direction is descendants only: from a parent row we find the child rows that
//! reference it (incoming FKs), then their children, and so on. Rows are matched
//! on the text form of their key values (simple-query protocol), the same way
//! `pg::filter_sql`/`pg::update_sql` compare. Cycles and diamonds are bounded by
//! a per-table seen-set keyed on the primary key (or the whole row when a table
//! has none), and the whole crawl is capped by `MAX_TOTAL_ROWS`.

use std::collections::{HashMap, HashSet, VecDeque};

use tokio_postgres::Client;

use crate::models::{CellValue, FkRef};
use crate::pg::{self, quote_ident, quote_lit};

/// Hard ceiling on the rows pulled across all tables, so a mis-aimed seed (or a
/// hub table everything points back to) can't drag the whole database into
/// memory. Hitting it sets `truncated`.
const MAX_TOTAL_ROWS: usize = 200_000;
/// Tuples per `IN (...)` batch — keeps each generated statement bounded.
const IN_CHUNK: usize = 1_000;

/// One table's collected rows. `seen` dedups rows across the whole crawl;
/// `expanded` marks how far `rows` has already had its children fetched, so each
/// row's children are queried exactly once even as the table is re-queued.
pub struct CollectedTable {
    pub schema: String,
    pub table: String,
    pub columns: Vec<String>,
    /// indices into `columns` that form the primary key; empty when none
    pub pk_idx: Vec<usize>,
    pub rows: Vec<Vec<Option<String>>>,
    /// primary-key column names, resolved to `pk_idx` once `columns` is known
    pk_names: Vec<String>,
    seen: HashSet<String>,
    expanded: usize,
}

impl CollectedTable {
    fn new(schema: &str, table: &str, pk_names: Vec<String>) -> Self {
        Self {
            schema: schema.to_string(),
            table: table.to_string(),
            columns: Vec::new(),
            pk_idx: Vec::new(),
            rows: Vec::new(),
            pk_names,
            seen: HashSet::new(),
            expanded: 0,
        }
    }

    /// Adopt the column list from a query result the first time we see it, and
    /// resolve the primary-key column names to positional indices for dedup.
    fn ensure_columns(&mut self, cols: &[String]) {
        if self.columns.is_empty() && !cols.is_empty() {
            self.pk_idx = self
                .pk_names
                .iter()
                .filter_map(|n| cols.iter().position(|c| c == n))
                .collect();
            self.columns = cols.to_vec();
        }
    }
}

pub struct Collected {
    pub tables: Vec<CollectedTable>,
    pub total_rows: usize,
    pub truncated: bool,
}

fn cell(row: &[Option<String>], i: usize) -> String {
    row.get(i).cloned().flatten().unwrap_or_default()
}

/// Stable text key for a row: its primary-key cell values, or every cell when
/// the table has no primary key. Values are length-prefixed so that ("a","bc")
/// and ("ab","c") never collide, and NULL is encoded distinctly from "".
fn dedup_key(row: &[Option<String>], pk_idx: &[usize]) -> String {
    let render = |i: usize| match row.get(i).and_then(|c| c.as_ref()) {
        Some(v) => format!("v{}:{}", v.len(), v),
        None => "n".to_string(),
    };
    if pk_idx.is_empty() {
        (0..row.len()).map(render).collect()
    } else {
        pk_idx.iter().map(|&i| render(i)).collect()
    }
}

/// Same length-prefixed encoding for an all-present value tuple (FK values are
/// only collected when none are NULL), used to dedup the `IN` batch.
fn tuple_key(vals: &[String]) -> String {
    vals.iter().map(|v| format!("v{}:{}", v.len(), v)).collect()
}

/// Build an `IN` predicate matching `child_cols` (compared on text, so any
/// column type works) against a non-empty batch of value tuples. Single column →
/// `col::text IN ('a','b')`; multi → `(c1::text, c2::text) IN (('a','x'),…)`.
fn in_predicate(child_cols: &[String], tuples: &[Vec<String>]) -> String {
    let multi = child_cols.len() > 1;
    let lhs = if multi {
        let cs: Vec<String> = child_cols
            .iter()
            .map(|c| format!("{}::text", quote_ident(c)))
            .collect();
        format!("({})", cs.join(", "))
    } else {
        format!("{}::text", quote_ident(&child_cols[0]))
    };
    let rows: Vec<String> = tuples
        .iter()
        .map(|t| {
            let vals: Vec<String> = t.iter().map(|v| quote_lit(v)).collect();
            if multi {
                format!("({})", vals.join(", "))
            } else {
                vals.into_iter().next().unwrap_or_else(|| "NULL".to_string())
            }
        })
        .collect();
    format!("{lhs} IN ({})", rows.join(", "))
}

/// WHERE clause pinning a row by its key values (text comparison; NULL → IS NULL),
/// the same shape `pg::update_sql` matches rows on.
fn key_where(keys: &[CellValue]) -> String {
    let parts: Vec<String> = keys
        .iter()
        .map(|k| {
            let col = quote_ident(&k.column);
            match &k.value {
                Some(v) => format!("{col}::text = {}", quote_lit(v)),
                None => format!("{col} IS NULL"),
            }
        })
        .collect();
    format!(" WHERE {}", parts.join(" AND "))
}

/// Primary-key column names for a relation.
async fn pk_columns(client: &Client, schema: &str, table: &str) -> Result<Vec<String>, String> {
    let sql = format!(
        "SELECT a.attname \
         FROM pg_index i \
         JOIN pg_class c ON c.oid = i.indrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) \
         WHERE i.indisprimary AND n.nspname = {} AND c.relname = {} \
         ORDER BY a.attnum",
        quote_lit(schema),
        quote_lit(table)
    );
    let res = pg::simple(client, &sql, 1_000).await?;
    Ok(res.rows.iter().map(|r| cell(r, 0)).collect())
}

/// Foreign keys *into* this relation, oriented for descent: `local_columns` are
/// the referenced columns on this table, `other_*` is the child relation and its
/// FK columns. Crosses schemas (a child can live anywhere). This is the
/// incoming branch of `commands::table_relations`.
async fn incoming_fks(client: &Client, schema: &str, table: &str) -> Result<Vec<FkRef>, String> {
    let sql = format!(
        "SELECT con.conname, cn.nspname, child.relname, \
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
         WHERE con.contype = 'f' AND pn.nspname = {} AND parent.relname = {} \
         ORDER BY con.conname",
        quote_lit(schema),
        quote_lit(table)
    );
    let res = pg::simple(client, &sql, 5_000).await?;
    let split = |s: String| s.split(',').map(|p| p.to_string()).collect::<Vec<_>>();
    Ok(res
        .rows
        .iter()
        .map(|r| FkRef {
            constraint: cell(r, 0),
            // confkey: the referenced columns on this (parent) table
            local_columns: split(cell(r, 4)),
            other_schema: cell(r, 1),
            other_table: cell(r, 2),
            // conkey: the FK columns on the child table
            other_columns: split(cell(r, 3)),
        })
        .collect())
}

/// Crawl descendants of the seed row(s) breadth-first and return every table
/// touched, each with its collected rows. The seed is identified by its
/// primary-key values; the result always includes the seed table itself.
pub async fn collect_descendants(
    client: &Client,
    seed_schema: &str,
    seed_table: &str,
    seed_keys: &[CellValue],
) -> Result<Collected, String> {
    if seed_keys.is_empty() {
        return Err("table has no primary key to identify the row".to_string());
    }

    let seed_sql = format!(
        "SELECT * FROM {}.{}{}",
        quote_ident(seed_schema),
        quote_ident(seed_table),
        key_where(seed_keys)
    );
    let seed_res = pg::simple(client, &seed_sql, MAX_TOTAL_ROWS).await?;
    if seed_res.rows.is_empty() {
        return Err("the selected row was not found".to_string());
    }

    let mut tables: Vec<CollectedTable> = Vec::new();
    let mut index: HashMap<(String, String), usize> = HashMap::new();
    let mut fk_cache: HashMap<(String, String), Vec<FkRef>> = HashMap::new();
    let mut queue: VecDeque<(String, String)> = VecDeque::new();
    let mut total_rows = 0usize;
    let mut truncated = false;

    // seed table
    let seed_pk = pk_columns(client, seed_schema, seed_table).await?;
    let mut seed_tbl = CollectedTable::new(seed_schema, seed_table, seed_pk);
    seed_tbl.ensure_columns(&seed_res.columns);
    for row in seed_res.rows {
        let k = dedup_key(&row, &seed_tbl.pk_idx);
        if seed_tbl.seen.insert(k) {
            seed_tbl.rows.push(row);
            total_rows += 1;
        }
    }
    let seed_loc = (seed_schema.to_string(), seed_table.to_string());
    index.insert(seed_loc.clone(), 0);
    tables.push(seed_tbl);
    queue.push_back(seed_loc);

    while let Some(loc) = queue.pop_front() {
        if truncated {
            break;
        }
        let cur = index[&loc];

        // window of rows on this table not yet expanded
        let (start, end) = (tables[cur].expanded, tables[cur].rows.len());
        if start >= end {
            continue;
        }
        tables[cur].expanded = end;

        let fks = match fk_cache.get(&loc) {
            Some(v) => v.clone(),
            None => {
                let v = incoming_fks(client, &loc.0, &loc.1).await?;
                fk_cache.insert(loc.clone(), v.clone());
                v
            }
        };

        for fk in &fks {
            // positions of the referenced columns on the current table
            let local_idx: Option<Vec<usize>> = fk
                .local_columns
                .iter()
                .map(|c| tables[cur].columns.iter().position(|col| col == c))
                .collect();
            let Some(local_idx) = local_idx else { continue };

            // distinct, fully non-null value tuples from the new rows
            let mut seen_tuples: HashSet<String> = HashSet::new();
            let mut tuples: Vec<Vec<String>> = Vec::new();
            for row in &tables[cur].rows[start..end] {
                let mut tup = Vec::with_capacity(local_idx.len());
                let mut ok = true;
                for &i in &local_idx {
                    match row.get(i).and_then(|c| c.as_ref()) {
                        Some(v) => tup.push(v.clone()),
                        None => {
                            ok = false;
                            break;
                        }
                    }
                }
                if ok && seen_tuples.insert(tuple_key(&tup)) {
                    tuples.push(tup);
                }
            }
            if tuples.is_empty() {
                continue;
            }

            // ensure the child table has a slot (and its PK resolved)
            let child_loc = (fk.other_schema.clone(), fk.other_table.clone());
            if !index.contains_key(&child_loc) {
                let pk = pk_columns(client, &fk.other_schema, &fk.other_table).await?;
                index.insert(child_loc.clone(), tables.len());
                tables.push(CollectedTable::new(&fk.other_schema, &fk.other_table, pk));
            }
            let child = index[&child_loc];

            let mut added = false;
            for chunk in tuples.chunks(IN_CHUNK) {
                if truncated {
                    break;
                }
                let sql = format!(
                    "SELECT * FROM {}.{} WHERE {}",
                    quote_ident(&fk.other_schema),
                    quote_ident(&fk.other_table),
                    in_predicate(&fk.other_columns, chunk)
                );
                let res = pg::simple(client, &sql, MAX_TOTAL_ROWS).await?;
                tables[child].ensure_columns(&res.columns);
                for row in res.rows {
                    if total_rows >= MAX_TOTAL_ROWS {
                        truncated = true;
                        break;
                    }
                    let k = dedup_key(&row, &tables[child].pk_idx);
                    if tables[child].seen.insert(k) {
                        tables[child].rows.push(row);
                        total_rows += 1;
                        added = true;
                    }
                }
            }
            if added {
                queue.push_back(child_loc);
            }
        }
    }

    Ok(Collected {
        tables,
        total_rows,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_predicate_single_column() {
        let p = in_predicate(&["id".to_string()], &[vec!["1".into()], vec!["2".into()]]);
        assert_eq!(p, "\"id\"::text IN ('1', '2')");
    }

    #[test]
    fn in_predicate_multi_column_escapes_quotes() {
        let p = in_predicate(
            &["a".to_string(), "b".to_string()],
            &[vec!["x".into(), "y'z".into()]],
        );
        assert_eq!(p, "(\"a\"::text, \"b\"::text) IN (('x', 'y''z'))");
    }

    #[test]
    fn dedup_key_distinguishes_concatenations() {
        let pk = vec![0usize, 1];
        let a = dedup_key(&[Some("a".into()), Some("bc".into())], &pk);
        let b = dedup_key(&[Some("ab".into()), Some("c".into())], &pk);
        assert_ne!(a, b);
    }

    #[test]
    fn dedup_key_null_distinct_from_empty() {
        let pk = vec![0usize];
        assert_ne!(
            dedup_key(&[None], &pk),
            dedup_key(&[Some(String::new())], &pk)
        );
    }

    #[test]
    fn dedup_key_no_pk_uses_whole_row() {
        let r1 = vec![Some("1".into()), Some("a".into())];
        let r2 = vec![Some("1".into()), Some("b".into())];
        assert_ne!(dedup_key(&r1, &[]), dedup_key(&r2, &[]));
    }

    #[test]
    fn key_where_text_match_and_null() {
        let keys = vec![
            CellValue { column: "id".into(), value: Some("7".into()) },
            CellValue { column: "tag".into(), value: None },
        ];
        assert_eq!(key_where(&keys), " WHERE \"id\"::text = '7' AND \"tag\" IS NULL");
    }
}
