// Integration tests against a local Postgres (skipped silently if none is
// listening on localhost:5432). Run: cargo test -- --nocapture

use strata_lib::models::{CellValue, ConnectionProfile, Filter, RowUpdate};
use strata_lib::pg;

fn cv(column: &str, value: Option<&str>) -> CellValue {
    CellValue { column: column.into(), value: value.map(|v| v.into()) }
}

#[test]
fn mutation_sql_builders() {
    // update: quoted idents, escaped literals, text-form key match, NULL set
    let sql = pg::update_sql(
        "public",
        "users",
        &[cv("id", Some("42"))],
        &[cv("name", Some("o'brien")), cv("note", None)],
    )
    .unwrap();
    assert_eq!(
        sql,
        "UPDATE \"public\".\"users\" SET \"name\" = 'o''brien', \"note\" = NULL WHERE \"id\"::text = '42'"
    );

    // NULL key matches with IS NULL; no keys is an error
    let sql = pg::delete_sql("public", "t", &[cv("k", None)]).unwrap();
    assert_eq!(sql, "DELETE FROM \"public\".\"t\" WHERE \"k\" IS NULL");
    assert!(pg::update_sql("public", "t", &[], &[cv("a", None)]).is_err());
    assert!(pg::update_sql("public", "t", &[cv("k", Some("1"))], &[]).is_err());

    // insert: explicit values, NULLs, and the all-defaults form
    let sql = pg::insert_sql("public", "t", &[cv("a", Some("1")), cv("b", None)]);
    assert_eq!(sql, "INSERT INTO \"public\".\"t\" (\"a\", \"b\") VALUES ('1', NULL)");
    assert_eq!(pg::insert_sql("public", "t", &[]), "INSERT INTO \"public\".\"t\" DEFAULT VALUES");
}

fn local_profile() -> ConnectionProfile {
    ConnectionProfile {
        id: "test".into(),
        name: "test".into(),
        host: "localhost".into(),
        port: 5432,
        user: std::env::var("USER").unwrap_or_else(|_| "postgres".into()),
        password: String::new(),
        database: "postgres".into(),
        ssl_mode: "prefer".into(),
        color: "#4fa8ff".into(),
    }
}

#[tokio::test]
async fn end_to_end_against_local_postgres() {
    let client = match pg::open(&local_profile()).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("skipping: no local postgres ({e})");
            return;
        }
    };

    // version
    let res = pg::simple(&client, "SELECT version()", 1).await.unwrap();
    assert_eq!(res.rows.len(), 1);
    assert!(res.rows[0][0].as_deref().unwrap().contains("PostgreSQL"));

    // database list (drives the db switcher) includes the connected db
    let res = pg::simple(
        &client,
        "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname",
        1000,
    )
    .await
    .unwrap();
    assert!(res.rows.iter().any(|r| r[0].as_deref() == Some("postgres")));

    // build a scratch table covering tricky types
    pg::simple(&client, "DROP TABLE IF EXISTS strata_test", 1).await.unwrap();
    pg::simple(
        &client,
        "CREATE TABLE strata_test (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), \
         name text, n int, meta jsonb, at timestamptz DEFAULT now())",
        1,
    )
    .await
    .unwrap();
    pg::simple(
        &client,
        "INSERT INTO strata_test (name, n, meta) VALUES \
         ('ada', 1, '{\"a\":1}'), ('grace', 2, NULL), (NULL, 3, '[]'), ('o''brien', 42, '{}')",
        1,
    )
    .await
    .unwrap();

    // rows with the same SQL shape the table_rows command builds
    let filters = vec![Filter { column: "name".into(), op: "contains".into(), value: "a".into() }];
    let where_sql = pg::filter_sql(&filters).unwrap();
    let sql = format!(
        "SELECT * FROM {}.{}{} ORDER BY {} ASC LIMIT 100 OFFSET 0",
        pg::quote_ident("public"),
        pg::quote_ident("strata_test"),
        where_sql,
        pg::quote_ident("n")
    );
    let res = pg::simple(&client, &sql, 100).await.unwrap();
    assert_eq!(res.columns, vec!["id", "name", "n", "meta", "at"]);
    assert_eq!(res.rows.len(), 2); // ada, grace
    assert_eq!(res.rows[0][1].as_deref(), Some("ada"));
    assert_eq!(res.rows[0][3].as_deref(), Some("{\"a\": 1}"));
    assert_eq!(res.rows[1][3], None); // NULL jsonb comes through as None

    // quoted-literal escaping (o'brien)
    let filters = vec![Filter { column: "name".into(), op: "eq".into(), value: "o'brien".into() }];
    let sql = format!("SELECT count(*) FROM strata_test{}", pg::filter_sql(&filters).unwrap());
    let res = pg::simple(&client, &sql, 1).await.unwrap();
    assert_eq!(res.rows[0][0].as_deref(), Some("1"));

    // null / notnull ops
    let filters = vec![Filter { column: "name".into(), op: "null".into(), value: String::new() }];
    let sql = format!("SELECT count(*) FROM strata_test{}", pg::filter_sql(&filters).unwrap());
    let res = pg::simple(&client, &sql, 1).await.unwrap();
    assert_eq!(res.rows[0][0].as_deref(), Some("1"));

    // multi-statement script (editor path) + affected count
    let res = pg::simple(&client, "UPDATE strata_test SET n = n + 1; SELECT 1", 10).await.unwrap();
    assert_eq!(res.affected, Some(4));

    // truncation
    let res = pg::simple(&client, "SELECT generate_series(1, 50)", 10).await.unwrap();
    assert_eq!(res.rows.len(), 10);
    assert!(res.truncated);

    // db error surfaces as a readable message
    let err = pg::simple(&client, "SELECT * FROM does_not_exist_xyz", 10).await.unwrap_err();
    assert!(err.contains("does_not_exist_xyz"));

    // ---- inline editing round-trip ----

    // insert (typed literals cast to int/jsonb), then read the row back
    let sql = pg::insert_sql(
        "public",
        "strata_test",
        &[cv("name", Some("edith")), cv("n", Some("7")), cv("meta", None)],
    );
    assert_eq!(pg::simple(&client, &sql, 1).await.unwrap().affected, Some(1));
    let res = pg::simple(&client, "SELECT id, meta FROM strata_test WHERE name = 'edith'", 10)
        .await
        .unwrap();
    assert_eq!(res.rows.len(), 1);
    assert_eq!(res.rows[0][1], None);
    let edith_id = res.rows[0][0].clone();

    // update by uuid pk matched on its text form, guarded to exactly one row
    let sql = pg::update_sql(
        "public",
        "strata_test",
        &[cv("id", edith_id.as_deref())],
        &[cv("n", Some("99")), cv("name", None)],
    )
    .unwrap();
    assert_eq!(pg::exec_expect(&client, &sql, 1).await.unwrap(), 1);
    let res = pg::simple(&client, "SELECT name FROM strata_test WHERE n = 99", 10).await.unwrap();
    assert_eq!(res.rows.len(), 1);
    assert_eq!(res.rows[0][0], None);

    // batched edits: two rows saved in one transaction
    let updates = vec![
        RowUpdate { keys: vec![cv("n", Some("2"))], changes: vec![cv("name", Some("ada-2"))] },
        RowUpdate { keys: vec![cv("n", Some("3"))], changes: vec![cv("name", Some("grace-2"))] },
    ];
    assert_eq!(pg::apply_updates(&client, "public", "strata_test", &updates).await.unwrap(), 2);
    let res = pg::simple(
        &client,
        "SELECT count(*) FROM strata_test WHERE name IN ('ada-2','grace-2')",
        1,
    )
    .await
    .unwrap();
    assert_eq!(res.rows[0][0].as_deref(), Some("2"));

    // batched edits are all-or-nothing: a row matching 0 rolls back the batch
    let updates = vec![
        RowUpdate { keys: vec![cv("n", Some("2"))], changes: vec![cv("name", Some("ada-3"))] },
        RowUpdate { keys: vec![cv("n", Some("12345"))], changes: vec![cv("name", Some("ghost"))] },
    ];
    let err = pg::apply_updates(&client, "public", "strata_test", &updates).await.unwrap_err();
    assert!(err.contains("row 2 matched 0 rows"));
    let res = pg::simple(&client, "SELECT count(*) FROM strata_test WHERE name = 'ada-3'", 1)
        .await
        .unwrap();
    assert_eq!(res.rows[0][0].as_deref(), Some("0")); // first row rolled back too

    // guard: a write matching 0 rows rolls back and errors
    let sql = pg::update_sql(
        "public",
        "strata_test",
        &[cv("id", Some("00000000-0000-4000-8000-000000000000"))],
        &[cv("n", Some("1"))],
    )
    .unwrap();
    let err = pg::exec_expect(&client, &sql, 1).await.unwrap_err();
    assert!(err.contains("matched 0 rows"));
    // and the connection is usable again after the rollback
    assert_eq!(pg::simple(&client, "SELECT 1", 1).await.unwrap().rows.len(), 1);

    // ---- EXPLAIN visualizer ----

    // plan comes back as one JSON document (trailing semicolons tolerated)
    let plan = pg::explain(&client, "SELECT * FROM strata_test WHERE n > 1;", false)
        .await
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&plan).unwrap();
    assert!(parsed[0]["Plan"]["Node Type"].is_string());
    assert!(parsed[0].get("Execution Time").is_none()); // estimates only

    // ANALYZE really executes — and must roll back, even for a write
    let plan = pg::explain(&client, "UPDATE strata_test SET n = n + 1000", true)
        .await
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&plan).unwrap();
    assert!(parsed[0]["Execution Time"].is_number());
    let res = pg::simple(&client, "SELECT count(*) FROM strata_test WHERE n >= 1000", 1)
        .await
        .unwrap();
    assert_eq!(res.rows[0][0].as_deref(), Some("0")); // the update did not land

    // delete the inserted row
    let sql = pg::delete_sql("public", "strata_test", &[cv("id", edith_id.as_deref())]).unwrap();
    assert_eq!(pg::exec_expect(&client, &sql, 1).await.unwrap(), 1);
    let res = pg::simple(&client, "SELECT count(*) FROM strata_test", 1).await.unwrap();
    assert_eq!(res.rows[0][0].as_deref(), Some("4"));

    pg::simple(&client, "DROP TABLE strata_test", 1).await.unwrap();
}
