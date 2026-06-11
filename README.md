# Strata

A native macOS Postgres data browser — the fast counterpart to pgAdmin.
Connect, click a table, and see your data instantly: filter, sort and page
without writing SQL, with a proper editor one tab away when you need it.

Built with Tauri 2 + React 19 + Tailwind 4, in the same native-glass style as
Cumulus and Sentinel.

## Features

- **Connections** — saved profiles (host, user, database, SSL mode), one-click
  connect with a built-in connection test. Multiple live connections at once.
- **Browse** — schema/table tree with row estimates, instant data grid with
  column sorting, stackable filters (contains/=/≠/ranges/null), exact counts
  on demand, pagination, a structure tab (types, PKs, defaults) and a
  row-detail drawer with copy-as-JSON.
- **Query** — SQL editor (⌘↩ to run) supporting multi-statement scripts,
  result grid, elapsed/row chips, copy-as-CSV, and local query history.
- **Ask AI** — type a question in plain English ("top 10 customers by revenue
  this month") and Strata generates the SQL from your live schema, dropping it
  into the editor and auto-running it when it's read-only. Powered by your local
  Claude CLI sign-in — no API key. Write queries are inserted for review first.
- **Native feel** — transparent vibrancy window, hidden title bar, dark glass
  UI, no Electron.

## Run

```sh
bun install
bun run app           # dev, hot reload
bun run install-app   # release build → /Applications/Strata.app (this Mac)
```

`bun run dev` serves the UI in a browser against fictional demo data — handy
for UI iteration and screenshots.

## Share it with someone else

`bun run dist` builds a **universal** (Intel + Apple Silicon) disk image:

```sh
bun run dist
# → src-tauri/target/universal-apple-darwin/release/bundle/dmg/Strata_<version>_universal.dmg
```

Send them that `.dmg`. They open it and drag **Strata** into Applications.

The build is **not signed with an Apple Developer ID**, so the first launch
needs a one-time Gatekeeper bypass — either:

- **Right-click** Strata in Applications → **Open** → **Open** in the dialog, or
- run once in Terminal: `xattr -cr /Applications/Strata.app`

After that it opens normally. To drop this step entirely, sign + notarize the
build with a Developer ID certificate.

**AI SQL generation** needs the [Claude CLI](https://claude.com/claude-code)
installed and signed in on their machine; without it the app works fully but
the "Ask AI" bar is hidden.

## Storage

Connection profiles (passwords included, plaintext like pgpass) and prefs are
stored in `~/Library/Application Support/app.strata.desktop/settings.json`.
