//! Serialize a result set (columns + text rows, as they come back from the
//! simple-query protocol) to a downloadable text format. NULL is rendered as
//! an empty field everywhere except SQL, where it becomes the `NULL` keyword.

use std::borrow::Cow;

use crate::pg::{quote_ident, quote_lit};

#[derive(Clone, Copy)]
pub enum Format {
    Csv,
    Tsv,
    Json,
    Sql,
}

impl Format {
    pub fn parse(s: &str) -> Result<Format, String> {
        match s {
            "csv" => Ok(Format::Csv),
            "tsv" => Ok(Format::Tsv),
            "json" => Ok(Format::Json),
            "sql" => Ok(Format::Sql),
            other => Err(format!("unknown export format: {other}")),
        }
    }
}

/// Render the whole result set. `table` is the (already quoted) qualified name
/// used as the INSERT target for the SQL format; it is ignored otherwise.
pub fn render(
    fmt: Format,
    columns: &[String],
    rows: &[Vec<Option<String>>],
    table: &str,
) -> Result<String, String> {
    match fmt {
        Format::Csv => Ok(delimited(columns, rows, ',')),
        Format::Tsv => Ok(delimited(columns, rows, '\t')),
        Format::Json => json(columns, rows),
        Format::Sql => Ok(sql(columns, rows, table)),
    }
}

/// RFC-4180-style quoting, parameterised on the delimiter so it serves both CSV
/// and TSV: a field is quoted only when it contains the delimiter, a quote or a
/// line break, and embedded quotes are doubled. NULL renders as an empty field.
fn delimited(columns: &[String], rows: &[Vec<Option<String>>], delim: char) -> String {
    let mut out = String::new();
    push_row(&mut out, columns.iter().map(|s| Some(s.as_str())), delim);
    for row in rows {
        push_row(&mut out, row.iter().map(|v| v.as_deref()), delim);
    }
    out
}

fn push_row<'a>(out: &mut String, cells: impl Iterator<Item = Option<&'a str>>, delim: char) {
    let mut first = true;
    for cell in cells {
        if !first {
            out.push(delim);
        }
        first = false;
        if let Some(v) = cell {
            out.push_str(&field(v, delim));
        }
    }
    out.push('\n');
}

fn field(s: &str, delim: char) -> Cow<'_, str> {
    if s.contains(delim) || s.contains('"') || s.contains('\n') || s.contains('\r') {
        Cow::Owned(format!("\"{}\"", s.replace('"', "\"\"")))
    } else {
        Cow::Borrowed(s)
    }
}

/// An array of objects, one per row. Every value is a string (the text form) or
/// null — honest about the simple-query protocol giving us text for all types.
fn json(columns: &[String], rows: &[Vec<Option<String>>]) -> Result<String, String> {
    use serde_json::{Map, Value};
    let arr: Vec<Value> = rows
        .iter()
        .map(|row| {
            let mut obj = Map::with_capacity(columns.len());
            for (i, col) in columns.iter().enumerate() {
                let v = row
                    .get(i)
                    .and_then(|c| c.clone())
                    .map(Value::String)
                    .unwrap_or(Value::Null);
                obj.insert(col.clone(), v);
            }
            Value::Object(obj)
        })
        .collect();
    serde_json::to_string_pretty(&arr).map_err(|e| e.to_string())
}

/// One `INSERT INTO <table> (cols) VALUES (…);` per row. Values are written as
/// untyped literals (or NULL), the same shape `insert_sql` produces, so the
/// dump replays cleanly into a matching table.
fn sql(columns: &[String], rows: &[Vec<Option<String>>], table: &str) -> String {
    let cols = columns
        .iter()
        .map(|c| quote_ident(c))
        .collect::<Vec<_>>()
        .join(", ");
    let mut out = String::new();
    for row in rows {
        let vals = (0..columns.len())
            .map(|i| match row.get(i).and_then(|v| v.as_ref()) {
                Some(v) => quote_lit(v),
                None => "NULL".to_string(),
            })
            .collect::<Vec<_>>()
            .join(", ");
        out.push_str(&format!("INSERT INTO {table} ({cols}) VALUES ({vals});\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> (Vec<String>, Vec<Vec<Option<String>>>) {
        let columns = vec!["id".to_string(), "name".to_string()];
        let rows = vec![
            vec![Some("1".to_string()), Some("Ada".to_string())],
            // value with a comma, a quote and a newline; and a NULL
            vec![Some("2".to_string()), Some("a,b\"c\nd".to_string())],
            vec![Some("3".to_string()), None],
        ];
        (columns, rows)
    }

    #[test]
    fn csv_quotes_only_when_needed_and_doubles_quotes() {
        let (c, r) = sample();
        let out = render(Format::Csv, &c, &r, "").unwrap();
        assert_eq!(
            out,
            "id,name\n1,Ada\n2,\"a,b\"\"c\nd\"\n3,\n".to_string()
        );
    }

    #[test]
    fn tsv_uses_tab_delimiter() {
        let (c, r) = sample();
        let out = render(Format::Tsv, &c, &r, "").unwrap();
        assert_eq!(out.lines().next(), Some("id\tname"));
        assert_eq!(out.lines().nth(1), Some("1\tAda"));
    }

    #[test]
    fn json_is_array_of_objects_with_nulls() {
        let (c, r) = sample();
        let out = render(Format::Json, &c, &r, "").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v[0]["name"], "Ada");
        assert!(v[2]["name"].is_null());
    }

    #[test]
    fn sql_escapes_literals_and_renders_null() {
        let (c, r) = sample();
        let out = render(Format::Sql, &c, &r, "\"public\".\"t\"").unwrap();
        assert!(out.contains("INSERT INTO \"public\".\"t\" (\"id\", \"name\") VALUES ('1', 'Ada');"));
        assert!(out.contains("VALUES ('3', NULL);"));
    }

    #[test]
    fn unknown_format_errors() {
        assert!(Format::parse("xml").is_err());
    }
}
