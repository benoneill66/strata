// Integration tests against a local Postgres (skipped silently if none is
// listening on localhost:5432). Run: cargo test -- --nocapture

use strata_lib::models::{ConnectionProfile, Filter};
use strata_lib::pg;

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

    pg::simple(&client, "DROP TABLE strata_test", 1).await.unwrap();
}
