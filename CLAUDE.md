# Strata — agent guidance

Strata is a Tauri 2 + React (Vite) desktop app: a native Postgres data browser
for quick lookups without writing SQL — the fast counterpart to pgAdmin.
Frontend lives in `src/`, the Rust backend in `src-tauri/`. The built app
installs to `/Applications/Strata.app`.

## How it talks to Postgres

The Rust backend connects with **tokio-postgres over the simple-query
protocol** (`src-tauri/src/pg.rs`): every value comes back as text, so
arbitrary column types render in the grid without per-type decoding, and the
editor can run multi-statement scripts. TLS uses native-tls with verification
disabled (pgAdmin-style "prefer/require" semantics); `prefer` falls back to
plaintext for local servers. There is no parameter binding on this protocol —
grid filters are built via `quote_ident`/`quote_lit` in `pg::filter_sql`; keep
any new SQL construction inside `pg.rs` and reuse those helpers. Row mutations
(inline editing in Browse) are built by `pg::update_sql`/`insert_sql`/
`delete_sql` — rows are matched on their primary-key values in text form.
Cell edits stage in the frontend (`pending` in `views/Browse.tsx`, keyed on
pk+column so they survive paging/reloads) and save as one batch through
`pg::apply_updates`, a single transaction where every UPDATE must touch
exactly one row or the whole batch rolls back; single-row deletes go through
`pg::exec_expect` with the same exactly-one guard.

Live connections are held in `pg::Pool` (HashMap of `tokio_postgres::Client`
keyed by profile id) managed in `AppState`. Saved connection profiles —
including passwords, plaintext like pgpass — persist to `settings.json` in the
app-data dir via `get_settings`/`save_settings`.

Every Tauri command in `src-tauri/src/commands.rs` shapes results into the
structs in `models.rs`, which mirror the TypeScript types in
`src/lib/types.ts` (snake_case on both sides).

## AI SQL generation

`src-tauri/src/ai.rs` shells out to the **Claude CLI** (`claude -p
--output-format json`, tool-less) — same approach as Sentinel, with the same
Finder-PATH probing for the `claude` binary. `generate_sql` builds a compact
schema dump of the connected database (`schema_context` in `commands.rs`,
capped at ~14k chars) as the system prompt and feeds the user's natural-language
question on stdin; the model returns `{sql, explanation}`. The Query view's AI
bar inserts the SQL into the editor; auto-running is opt-in via the Auto-run
toggle (off by default, persisted in localStorage), and even then only fires
for read-only queries (`isReadOnly` in `views/Query.tsx`) — write queries are
always inserted for review only.
No API key — auth rides on the user's existing Claude CLI sign-in. `ai_status`
reports availability (shown in Settings). The live path is covered by
`tests/ai_smoke.rs` (gated behind `STRATA_TEST_AI=1`). The same CLI pipeline
powers `diagnose_plan` — the Diagnose button in the EXPLAIN visualizer
(`components/PlanView.tsx`), which sends the SQL + plan JSON for a short
bottleneck diagnosis. Plans come from `pg::explain`, which always wraps the
statement in BEGIN/ROLLBACK so EXPLAIN ANALYZE on a write never lands.

## Toolchain — use Bun

- `bun install` — deps.
- `bun run app` — run in dev (hot reload, opens the window).
- `bun run build` — type-check + build the frontend only.
- `bun run dev` — browser-only UI iteration against demo data (`src/lib/demo.ts`).
- `bun run install-app` — release build + reinstall to `/Applications`.
- `cargo test` (in `src-tauri/`) — integration tests against localhost:5432
  (skipped silently when no local Postgres is running).

`beforeDevCommand`/`beforeBuildCommand` in `tauri.conf.json` call `bun run …`.

## ALWAYS reinstall when committing to `main`

Whenever you commit to `main`, rebuild and reinstall so the installed
`/Applications/Strata.app` reflects committed code:

```sh
bun run install-app
```

The release build is slow (several minutes) — let it finish.

## Aesthetic

Native macOS "thick glass" (same family as Cumulus/Sentinel): an
`NSVisualEffectMaterial::HudWindow` vibrancy view behind a transparent webview
(set in `lib.rs`), layered glass cards, a Postgres-blue → teal accent, an
animated aurora wash, and `.no-native` fallbacks for browser dev. Keep new UI
consistent with `src/styles.css` primitives (`.glass-card`, `.btn`, `.chip`,
`.seg`, `.data-table`, `.tbl-item`, `.drawer`).

## Views

Connections · Browse · Query · Settings. Views live in `src/views/` and load
data via `useAsync` (`src/lib/hooks.ts`) through the `api` wrapper
(`src/lib/api.ts`, demo fallback when not in Tauri). Browse and Query stay
mounted in `App.tsx` so table selection, filters and the SQL buffer survive
view switches. The shared results grid is `src/components/DataGrid.tsx`.
