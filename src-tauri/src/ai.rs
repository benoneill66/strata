use std::process::Stdio;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::models::AiProvider;

/// Generous cap so a wedged CLI can't hang the command forever, but slow model
/// turns over a big schema still complete.
const TIMEOUT_SECS: u64 = 120;
const CLAUDE_MODEL: &str = "sonnet";
const CLAUDE_EFFORT: &str = "low";
const CODEX_MODEL: &str = "gpt-5.4-mini";
const CODEX_REASONING_EFFORT: &str = "low";

#[derive(Debug, Clone, Serialize)]
pub struct SqlSuggestion {
    pub sql: String,
    pub explanation: String,
}

/// Locate the selected AI CLI. GUI apps launched from Finder don't inherit the
/// shell PATH, so probe common install locations first, then fall back to a
/// login shell. Resolved once per process. (Mirrors Sentinel's resolver.)
fn claude_bin() -> Option<&'static str> {
    static BIN: OnceLock<Option<String>> = OnceLock::new();
    BIN.get_or_init(|| {
        resolve_bin(
            "claude",
            &[
                ".local/bin/claude",
                ".claude/local/claude",
                ".bun/bin/claude",
                ".npm-global/bin/claude",
            ],
        )
    })
    .as_deref()
}

fn codex_bin() -> Option<&'static str> {
    static BIN: OnceLock<Option<String>> = OnceLock::new();
    BIN.get_or_init(|| {
        resolve_bin(
            "codex",
            &[
                ".local/bin/codex",
                ".codex/local/codex",
                ".bun/bin/codex",
                ".npm-global/bin/codex",
            ],
        )
    })
    .as_deref()
}

fn resolve_bin(name: &str, home_relative: &[&str]) -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut candidates: Vec<String> = home_relative
        .iter()
        .map(|p| format!("{home}/{p}"))
        .collect();
    candidates.push(format!("/opt/homebrew/bin/{name}"));
    candidates.push(format!("/usr/local/bin/{name}"));
    candidates.push(format!("/usr/bin/{name}"));
    for c in candidates {
        if std::path::Path::new(&c).exists() {
            return Some(c);
        }
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    if let Ok(out) = std::process::Command::new(&shell)
        .args(["-lc", &format!("command -v {name}")])
        .output()
    {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !p.is_empty() && std::path::Path::new(&p).exists() {
                return Some(p);
            }
        }
    }
    None
}

/// A sane PATH for CLI shell-outs — GUI launch inherits a slim one.
fn path_env() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    format!("{home}/.local/bin:{home}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
}

fn provider_bin(provider: AiProvider) -> Option<&'static str> {
    match provider {
        AiProvider::Claude => claude_bin(),
        AiProvider::Codex => codex_bin(),
    }
}

fn provider_name(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::Claude => "Claude",
        AiProvider::Codex => "Codex",
    }
}

/// Whether the selected CLI is available, and where. Surfaced in Settings.
pub fn cli_status(provider: AiProvider) -> (bool, String) {
    match provider_bin(provider) {
        Some(p) => (true, p.to_string()),
        None => (false, String::new()),
    }
}

pub fn provider_paths() -> (String, String) {
    (
        claude_bin().unwrap_or_default().to_string(),
        codex_bin().unwrap_or_default().to_string(),
    )
}

pub fn cli_config(provider: AiProvider) -> (&'static str, &'static str) {
    match provider {
        AiProvider::Claude => (CLAUDE_MODEL, CLAUDE_EFFORT),
        AiProvider::Codex => (CODEX_MODEL, CODEX_REASONING_EFFORT),
    }
}

/// Run one tool-less `claude -p` turn: `system` as the system prompt, `question`
/// on stdin. Returns the model's text (the `result` field of the JSON envelope).
async fn run_claude(system: &str, question: &str) -> Result<String, String> {
    let bin = claude_bin().ok_or(
        "Claude CLI not found. Install it (npm i -g @anthropic-ai/claude-code) and sign in.",
    )?;

    let mut cmd = Command::new(bin);
    cmd.arg("-p")
        .arg("--model")
        .arg(CLAUDE_MODEL)
        .arg("--effort")
        .arg(CLAUDE_EFFORT)
        .arg("--output-format")
        .arg("json")
        // Pure text generation: replace the agent system prompt, disable all
        // tools, and crucially `--strict-mcp-config` so NONE of the user's MCP
        // servers load. Without it the CLI would happily answer a data question
        // via e.g. RevenueCat instead of writing SQL — and loading those servers
        // is also what made the first call hang.
        .arg("--strict-mcp-config")
        .arg("--allowed-tools")
        .arg("")
        .arg("--system-prompt")
        .arg(system)
        // Neutral cwd so a project CLAUDE.md doesn't bias the prompt.
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // GUI launch has a slim PATH; give the CLI a sane one for any shell-outs.
        .env(
            "PATH",
            format!(
                "{}/.local/bin:{}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                std::env::var("HOME").unwrap_or_default(),
                std::env::var("HOME").unwrap_or_default()
            ),
        );

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not launch Claude CLI: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(question.as_bytes()).await;
        let _ = stdin.shutdown().await;
    }

    let output = match tokio::time::timeout(
        Duration::from_secs(TIMEOUT_SECS),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(format!("Claude CLI failed: {e}")),
        Err(_) => return Err("Claude CLI timed out.".into()),
    };

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let msg = err.trim();
        return Err(if msg.is_empty() {
            "Claude CLI exited with an error.".into()
        } else {
            format!("Claude CLI: {msg}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // `--output-format json` wraps the model text in a `result` field.
    let env: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Could not parse Claude response: {e}"))?;
    let text = env
        .get("result")
        .and_then(|v| v.as_str())
        .ok_or("Claude returned no result")?;
    Ok(text.to_string())
}

/// Run one `codex exec` turn. Codex does not have a system-prompt flag for exec,
/// so the instruction stack is sent as the prompt and the final answer is read
/// from `--output-last-message` to avoid parsing CLI banners/logs.
async fn run_codex(system: &str, question: &str) -> Result<String, String> {
    let bin = codex_bin().ok_or(
        "Codex CLI not found. Install the Codex CLI, run `codex login`, then reopen Strata.",
    )?;

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let output_path = std::env::temp_dir().join(format!(
        "strata-codex-{}-{nonce}.txt",
        std::process::id()
    ));
    let cwd = std::env::temp_dir();
    let prompt = format!(
        "You are being used as a pure text generation engine inside Strata. \
         Do not inspect files, run commands, use tools, or rely on external data.\n\n\
         System instructions:\n{system}\n\nUser request:\n{question}"
    );

    let mut cmd = Command::new(bin);
    cmd.arg("exec")
        .arg("--skip-git-repo-check")
        .arg("--ignore-user-config")
        .arg("--ignore-rules")
        .arg("--ephemeral")
        .arg("-c")
        .arg(format!("model=\"{CODEX_MODEL}\""))
        .arg("-c")
        .arg(format!("model_reasoning_effort=\"{CODEX_REASONING_EFFORT}\""))
        .arg("--sandbox")
        .arg("read-only")
        .arg("--cd")
        .arg(&cwd)
        .arg("--output-last-message")
        .arg(&output_path)
        .arg("-")
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("NO_COLOR", "1")
        .env(
            "PATH",
            format!(
                "{}/.local/bin:{}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                std::env::var("HOME").unwrap_or_default(),
                std::env::var("HOME").unwrap_or_default()
            ),
        );

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not launch Codex CLI: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt.as_bytes()).await;
        let _ = stdin.shutdown().await;
    }

    let output = match tokio::time::timeout(
        Duration::from_secs(TIMEOUT_SECS),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(format!("Codex CLI failed: {e}")),
        Err(_) => return Err("Codex CLI timed out.".into()),
    };

    let text = std::fs::read_to_string(&output_path).unwrap_or_default();
    let _ = std::fs::remove_file(&output_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let msg = stderr.trim();
        let msg = if msg.is_empty() { stdout.trim() } else { msg };
        return Err(if msg.is_empty() {
            "Codex CLI exited with an error.".into()
        } else {
            format!("Codex CLI: {msg}")
        });
    }

    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Codex returned an empty response.".into());
    }
    Ok(text)
}

async fn run_ai(provider: AiProvider, system: &str, question: &str) -> Result<String, String> {
    match provider {
        AiProvider::Claude => run_claude(system, question).await,
        AiProvider::Codex => run_codex(system, question).await,
    }
}

/// Pull the first JSON object out of model text (handles ```json fences and
/// stray prose around it).
fn extract_json(text: &str) -> Option<serde_json::Value> {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(text.trim()) {
        return Some(v);
    }
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str(&text[start..=end]).ok()
}

/// Ask the model to diagnose an EXPLAIN plan: dominant bottleneck + one
/// concrete fix. Plain text out — it renders in a small card, not a chat.
pub async fn diagnose_plan(provider: AiProvider, sql: &str, plan_json: &str) -> Result<String, String> {
    const MAX_PLAN: usize = 20_000;
    let mut plan = plan_json.to_string();
    if plan.len() > MAX_PLAN {
        plan.truncate(MAX_PLAN);
        plan.push_str("\n… (plan truncated)");
    }
    let system = "You are a senior PostgreSQL performance engineer. The user sends a SQL query \
         and its EXPLAIN plan as JSON (EXPLAIN ANALYZE when actual times are present). \
         Diagnose it: name the dominant bottleneck node and why it dominates, then give the \
         single most impactful concrete fix — an exact index to create, a query rewrite, or a \
         planner hint. If the plan is already efficient, say so plainly. \
         Respond in plain text (no markdown, no JSON), at most 4 short sentences.";
    let question = format!("SQL:\n{sql}\n\nPlan:\n{plan}");
    let text = run_ai(provider, system, &question).await?;
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(format!("{} returned an empty diagnosis.", provider_name(provider)));
    }
    Ok(text)
}

/// Ask the model for a single SQL query answering `question` against `schema_ctx`.
pub async fn generate_sql(
    provider: AiProvider,
    pg_version: &str,
    db: &str,
    schema_ctx: &str,
    question: &str,
) -> Result<SqlSuggestion, String> {
    let system = format!(
        "You are a senior PostgreSQL analyst with NO tools and NO live database access. \
         Do NOT attempt to answer the question with real data or any external source — your ONLY \
         job is to translate the question into SQL. Given a database schema and a question, \
         write exactly ONE PostgreSQL query that answers it.\n\
         Rules:\n\
         - Target PostgreSQL {pg_version}. Use ONLY tables and columns that appear in the schema below; never invent names.\n\
         - Copy table and column identifiers exactly as shown in the schema. If an identifier is shown in double quotes, keep those quotes every time you reference it.\n\
         - PostgreSQL folds unquoted mixed-case names to lowercase, so camelCase/PascalCase identifiers like \"dateOfBirth\" or \"User\" MUST be double-quoted, including after aliases (e.g. u.\"dateOfBirth\").\n\
         - Schema-qualify tables (e.g. public.users or public.\"User\") when helpful. Quote identifiers only if they need it.\n\
         - Default to a read-only SELECT. Do NOT write INSERT/UPDATE/DELETE/DDL unless the question explicitly asks to modify data.\n\
         - For row-returning queries add a sensible LIMIT (<= 500) unless the question is an aggregate/count.\n\
         - Prefer clear, correct SQL over clever SQL. Use ILIKE for case-insensitive text matching.\n\
         Respond with ONLY a JSON object and nothing else: {{\"sql\": \"<the query>\", \"explanation\": \"<one short sentence>\"}}.\n\n\
         Database \"{db}\". Schema:\n{schema_ctx}"
    );

    let text = run_ai(provider, &system, question).await?;
    let v = extract_json(&text).ok_or_else(|| {
        format!(
            "{} did not return usable SQL. It said: {}",
            provider_name(provider),
            text.chars().take(200).collect::<String>()
        )
    })?;
    let sql = v
        .get("sql")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if sql.is_empty() {
        return Err(format!("{} returned an empty query.", provider_name(provider)));
    }
    let explanation = v
        .get("explanation")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    Ok(SqlSuggestion { sql, explanation })
}

// ---------- chat agent ----------

/// Whether `sql` is a single read-only statement we're willing to auto-run for
/// the agent. Mirror of `isReadOnly` in `views/Query.tsx`: must start with a
/// read verb and contain no write/DDL keyword as a bare word. Comments stripped
/// first so they can't hide a verb.
pub fn is_read_only(sql: &str) -> bool {
    let chars: Vec<char> = sql.chars().collect();
    let mut s = String::with_capacity(sql.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '-' && i + 1 < chars.len() && chars[i + 1] == '-' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i = (i + 2).min(chars.len());
        } else {
            s.push(chars[i]);
            i += 1;
        }
    }
    let lower = s.trim().to_ascii_lowercase();
    let first = lower
        .split(|c: char| !c.is_ascii_alphabetic())
        .next()
        .unwrap_or("");
    if !matches!(first, "select" | "with" | "explain" | "show" | "table" | "values") {
        return false;
    }
    const FORBIDDEN: &[&str] = &[
        "insert", "update", "delete", "drop", "alter", "truncate", "create", "grant", "revoke",
        "comment", "merge", "call", "do", "vacuum", "reindex", "copy",
    ];
    !lower
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .any(|tok| FORBIDDEN.contains(&tok))
}

/// System prompt for the chat agent: a read-only Postgres analyst that answers
/// by running queries via the `RUN_SQL:` protocol the loop in `commands.rs`
/// drives. Identifier-quoting rules match `generate_sql`.
pub fn agent_system_prompt(pg_version: &str, db: &str, schema_ctx: &str) -> String {
    format!(
        "You are Strata's data agent: a senior PostgreSQL analyst embedded in a desktop \
Postgres browser. You answer the user's questions about THEIR database by running \
READ-ONLY SQL against it and interpreting the results. You have NO other tools and NO \
external data.\n\n\
HOW TO ACT — on every turn choose exactly ONE:\n\
1. To look something up, reply with a SINGLE message that starts with `RUN_SQL:` followed \
by one read-only PostgreSQL query, and NOTHING else — no prose, no markdown, no code \
fences. Example:\n\
RUN_SQL: SELECT * FROM public.users WHERE email = 'a@b.com' LIMIT 5\n\
The query runs immediately and its rows are handed back to you so you can keep going.\n\
2. When you have enough information, reply with your FINAL answer in markdown (any message \
that does NOT start with `RUN_SQL:`).\n\n\
RULES:\n\
- Target PostgreSQL {pg_version}. Use ONLY tables and columns from the schema below; never invent names.\n\
- Copy identifiers exactly as shown. PostgreSQL folds unquoted names to lowercase, so \
camelCase/PascalCase identifiers (e.g. \"dateOfBirth\") MUST stay double-quoted everywhere, including after aliases.\n\
- Schema-qualify tables when helpful (e.g. public.users). Use ILIKE for case-insensitive text matching.\n\
- Queries MUST be read-only (SELECT/WITH/EXPLAIN/SHOW); a write will be rejected. Add a sensible LIMIT (<= 200) to row-returning queries.\n\
- Prefer several small focused queries over one giant one. Never guess values — look them up.\n\
- Be concise and concrete; quote the actual values you found.\n\n\
ANSWER FORMAT (markdown): lead with the direct answer, then where useful add a short \
`### Data sources` section (tables/columns used) and an `### Assumptions` section.\n\n\
Database \"{db}\". Schema — table(col type, …):\n{schema_ctx}"
    )
}

/// Run one streaming agent turn. `system` is the agent prompt; `user_input` is
/// the full transcript (re-sent each turn, since the CLI is stateless).
/// `on_token` is invoked with each text delta as it streams. Returns the full
/// turn text. Claude streams token-by-token; Codex returns the answer in one
/// chunk (its exec stream format differs).
pub async fn stream_turn(
    provider: AiProvider,
    system: &str,
    user_input: &str,
    on_token: impl FnMut(&str),
) -> Result<String, String> {
    match provider {
        AiProvider::Claude => run_claude_stream(system, user_input, on_token).await,
        AiProvider::Codex => {
            let mut on_token = on_token;
            let text = run_codex(system, user_input).await?;
            on_token(&text);
            Ok(text)
        }
    }
}

/// `claude -p` with `--output-format stream-json --include-partial-messages`,
/// parsing the JSONL event stream for `text_delta`s and forwarding them live.
async fn run_claude_stream(
    system: &str,
    user_input: &str,
    mut on_token: impl FnMut(&str),
) -> Result<String, String> {
    let bin = claude_bin().ok_or(
        "Claude CLI not found. Install it (npm i -g @anthropic-ai/claude-code) and sign in.",
    )?;

    let mut cmd = Command::new(bin);
    cmd.arg("-p")
        .arg("--model")
        .arg(CLAUDE_MODEL)
        .arg("--effort")
        .arg(CLAUDE_EFFORT)
        .arg("--strict-mcp-config")
        .arg("--allowed-tools")
        .arg("")
        .arg("--system-prompt")
        .arg(system)
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .arg("--include-partial-messages")
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PATH", path_env());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not launch Claude CLI: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(user_input.as_bytes()).await;
        let _ = stdin.shutdown().await;
    }

    let stdout = child.stdout.take().ok_or("Claude CLI produced no stdout")?;
    let stderr = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        let mut s = String::new();
        if let Some(mut e) = stderr {
            let _ = e.read_to_string(&mut s).await;
        }
        s
    });

    let mut reader = BufReader::new(stdout).lines();
    let mut full = String::new();
    let mut result_text: Option<String> = None;
    let mut streamed_any = false;

    let read = async {
        while let Some(line) = reader
            .next_line()
            .await
            .map_err(|e| format!("Claude stream read error: {e}"))?
        {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let v: serde_json::Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            match v.get("type").and_then(|t| t.as_str()) {
                // partial token deltas (--include-partial-messages)
                Some("stream_event") => {
                    let ev = v.get("event");
                    let is_delta = ev
                        .and_then(|e| e.get("type"))
                        .and_then(|t| t.as_str())
                        == Some("content_block_delta");
                    if is_delta {
                        if let Some(t) = ev
                            .and_then(|e| e.get("delta"))
                            .and_then(|d| d.get("text"))
                            .and_then(|t| t.as_str())
                        {
                            full.push_str(t);
                            on_token(t);
                            streamed_any = true;
                        }
                    }
                }
                // authoritative final text
                Some("result") => {
                    if let Some(r) = v.get("result").and_then(|r| r.as_str()) {
                        result_text = Some(r.to_string());
                    }
                }
                _ => {}
            }
        }
        Ok::<(), String>(())
    };

    match tokio::time::timeout(Duration::from_secs(TIMEOUT_SECS), read).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => {
            let _ = child.start_kill();
            return Err("Claude CLI timed out.".into());
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Claude CLI failed: {e}"))?;
    let stderr_out = stderr_task.await.unwrap_or_default();

    if !status.success() && !streamed_any && result_text.is_none() {
        let msg = stderr_out.trim();
        return Err(if msg.is_empty() {
            "Claude CLI exited with an error.".into()
        } else {
            format!("Claude CLI: {msg}")
        });
    }

    // Older CLIs without partial deltas: stream the final result in one shot.
    if !streamed_any {
        if let Some(r) = &result_text {
            on_token(r);
            full = r.clone();
        }
    } else if full.is_empty() {
        if let Some(r) = result_text {
            full = r;
        }
    }
    Ok(full)
}

#[cfg(test)]
mod tests {
    use super::is_read_only;

    #[test]
    fn allows_reads() {
        assert!(is_read_only("SELECT * FROM users"));
        assert!(is_read_only("  with t as (select 1) select * from t"));
        assert!(is_read_only("EXPLAIN ANALYZE SELECT 1"));
        assert!(is_read_only("-- a comment\nselect 1"));
    }

    #[test]
    fn rejects_writes_and_ddl() {
        assert!(!is_read_only("DELETE FROM users"));
        assert!(!is_read_only("UPDATE users SET x = 1"));
        assert!(!is_read_only("insert into t values (1)"));
        assert!(!is_read_only("drop table t"));
        // a write hidden after a leading SELECT-looking CTE is still caught
        assert!(!is_read_only("with x as (select 1) delete from t"));
        // comment can't smuggle a verb past the first-word check
        assert!(!is_read_only("/* select */ truncate t"));
    }

    #[test]
    fn underscored_identifiers_are_not_keywords() {
        assert!(is_read_only("select created_at, updated_by from t"));
    }
}
