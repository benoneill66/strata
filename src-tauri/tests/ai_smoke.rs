// Exercises the real Claude CLI path. Skipped unless STRATA_TEST_AI=1 (it makes
// a live model call). Run: STRATA_TEST_AI=1 cargo test --test ai_smoke -- --nocapture

use strata_lib::models::ConnectionProfile;
use strata_lib::{ai, pg};

/// Build the same compact schema dump the `generate_sql` command sends as context.
async fn schema_dump(client: &tokio_postgres::Client, schema: &str) -> String {
    let sql = format!(
        "SELECT c.relname || '(' || string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum) || ')' \
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
         JOIN pg_attribute a ON a.attrelid = c.oid \
         WHERE n.nspname = '{schema}' AND c.relkind IN ('r','p','v','m','f') AND a.attnum > 0 AND NOT a.attisdropped \
         GROUP BY c.relname ORDER BY c.relname"
    );
    let res = pg::simple(client, &sql, 5000).await.unwrap();
    res.rows
        .iter()
        .filter_map(|r| r[0].clone())
        .collect::<Vec<_>>()
        .join("\n")
}

#[tokio::test]
async fn generates_select_from_tiny_schema() {
    if std::env::var("STRATA_TEST_AI").ok().as_deref() != Some("1") {
        eprintln!("skipping: set STRATA_TEST_AI=1 to run the live Claude call");
        return;
    }
    let (available, _) = ai::cli_status();
    if !available {
        eprintln!("skipping: claude CLI not found");
        return;
    }

    let schema = "public.users(id uuid, email text, plan text, trial_ends_at timestamptz, mrr_cents integer, created_at timestamptz)\n\
                  public.orders(id uuid, user_id uuid, total_cents integer, created_at timestamptz)\n";
    // A question the model could be tempted to answer from an MCP source (e.g.
    // RevenueCat) instead of writing SQL — verifies --strict-mcp-config holds.
    let s = ai::generate_sql("16.0", "shop", schema, "how many trial users do we have?")
        .await
        .expect("generate_sql failed");

    eprintln!("SQL: {}", s.sql);
    eprintln!("WHY: {}", s.explanation);
    let lower = s.sql.to_lowercase();
    assert!(lower.contains("select"), "expected a SELECT, got: {}", s.sql);
    assert!(lower.contains("users"), "expected it to reference users, got: {}", s.sql);
    // must not hallucinate tables outside the provided schema
    assert!(!lower.contains("customers"), "referenced a table not in schema: {}", s.sql);
}

/// Full pipeline against a real local database (set STRATA_TEST_AI_DB to the
/// dbname, e.g. STRATA_TEST_AI=1 STRATA_TEST_AI_DB=edge). Connects, dumps the
/// real public schema, and generates SQL — exactly what the app's command does.
#[tokio::test]
async fn end_to_end_against_real_db() {
    if std::env::var("STRATA_TEST_AI").ok().as_deref() != Some("1") {
        eprintln!("skipping: set STRATA_TEST_AI=1");
        return;
    }
    let (available, _) = ai::cli_status();
    if !available {
        eprintln!("skipping: claude CLI not found");
        return;
    }
    let db = std::env::var("STRATA_TEST_AI_DB").unwrap_or_else(|_| "postgres".into());
    let profile = ConnectionProfile {
        id: "t".into(),
        name: "t".into(),
        host: "localhost".into(),
        port: 5432,
        user: std::env::var("USER").unwrap_or_else(|_| "postgres".into()),
        password: String::new(),
        database: db.clone(),
        ssl_mode: "prefer".into(),
        color: "#4fa8ff".into(),
    };
    let client = match pg::open(&profile).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("skipping: cannot connect to {db} ({e})");
            return;
        }
    };

    let schema = schema_dump(&client, "public").await;
    eprintln!("schema dump: {} chars", schema.len());
    let question = std::env::var("STRATA_TEST_AI_Q")
        .unwrap_or_else(|_| "how many users signed up in the last 30 days?".into());

    let s = ai::generate_sql("16.0", &db, &schema, &question).await.expect("generate_sql failed");
    eprintln!("Q: {question}\nSQL: {}\nWHY: {}", s.sql, s.explanation);

    // The generated SQL should run cleanly against the real database.
    match pg::simple(&client, &s.sql, 50).await {
        Ok(res) => eprintln!("ran OK — {} columns, {} rows", res.columns.len(), res.rows.len()),
        Err(e) => panic!("generated SQL did not execute: {e}\nSQL: {}", s.sql),
    }
}
