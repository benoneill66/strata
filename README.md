<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="92" alt="Strata icon" />

# Strata

**A native macOS Postgres browser — the fast counterpart to pgAdmin.**

Connect, click a table, and see your data instantly: filter, sort and page
without writing SQL — with an interactive schema map, a full SQL editor and
natural-language → SQL one tab away.

[![Download](https://img.shields.io/github/v/release/benoneill66/strata?label=Download%20.dmg&style=for-the-badge&color=4fa8ff)](https://github.com/benoneill66/strata/releases/latest)
&nbsp;
![Platform](https://img.shields.io/badge/macOS-Intel%20%2B%20Apple%20Silicon-38d9c4?style=for-the-badge)
&nbsp;
[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-☕-ffdd00?style=for-the-badge)](https://buymeacoffee.com/benoneill)

<img src="docs/demo.gif" width="860" alt="Click a connection, click a table, see your Postgres data instantly in Strata" />

</div>

## Install

**[⬇︎ Download the latest `.dmg`](https://github.com/benoneill66/strata/releases/latest)** — universal, runs on both Intel and Apple Silicon Macs.

1. Open the `.dmg` and drag **Strata** into **Applications**.
2. **First launch only.** Strata isn't signed with an Apple Developer ID yet, so
   macOS quarantines it. Clear the flag once — open **Terminal** and run:
   ```sh
   xattr -cr /Applications/Strata.app
   ```
   Then double-click Strata as normal. That's it — you only ever do this once.

   <details>
   <summary>Prefer not to use Terminal?</summary>

   Double-click **Strata** — macOS will block it. Then go to
   **System Settings → Privacy & Security**, scroll to the bottom, and click
   **Open Anyway** next to the Strata message, then confirm with **Open**.
   *(On older macOS you can instead right-click Strata → **Open** → **Open**.)*
   </details>

   None of this means Strata is unsafe — it's the standard macOS gate for any app
   from a developer who hasn't paid for Apple's signing program yet. The source is
   right here if you'd like to read or build it yourself.

## Features

- **Connections** — saved profiles (host, user, database, SSL mode) live in a
  persistent sidebar rail, shared across Browse and Query. One-click connect with
  a built-in connection test; multiple live servers at once.
- **Browse** — schema/table tree with row estimates, an instant data grid with
  column sorting, stackable filters (contains / = / ≠ / ranges / null), exact
  counts on demand, pagination, a structure tab (types, PKs, defaults) and a
  row-detail drawer with copy-as-JSON.
- **Edit** — tables with a primary key are editable in place: double-click a
  cell to change it (with one-tap NULL). Edits stage locally — highlighted
  amber until you hit Save (⌘S) — then land together in a single transaction
  that rolls back entirely unless every row matches exactly once. Add rows
  from a column-aware drawer that knows defaults and nullability; delete rows
  from the detail drawer.
- **Schema** — an interactive ER diagram of the whole schema: force-laid-out
  table cards with primary/foreign-key markers and foreign-key edges. Pan, zoom,
  drag, search, and click a table to light up everything it links to. Toggle
  between table-only, key-columns or all-columns detail; orphan tables are
  parked in a tidy grid.
- **Explain** — a query-plan visualizer: EXPLAIN or EXPLAIN ANALYZE one click
  from the editor, rendered as a tree with flame-style self-time bars, row
  estimate-accuracy badges, disk-sort and loop markers, and expandable raw
  node details. Analyze captures real timings by running the query inside a
  transaction that always rolls back — safe even on writes. One more click
  gets an AI diagnosis of the bottleneck and the most impactful fix.
- **⌘K palette** — fuzzy-jump anywhere: every table in every schema, saved
  connections, databases on the active server, recent queries, and app
  actions, all from one keyboard-driven search box.
- **Query** — SQL editor (⌘↩ to run) for multi-statement scripts, result grid,
  elapsed/row chips, copy-as-CSV, and local query history.
- **Ask AI** — type a question in plain English and Strata writes the SQL from
  your live schema, dropping it into the editor and auto-running read-only
  queries. Powered by your local Claude or Codex CLI sign-in — no API key.
- **Native feel** — transparent vibrancy window, hidden title bar, dark glass UI.
  No Electron.

<div align="center">
<img src="docs/schema.png" width="820" alt="The interactive schema explorer" />
&nbsp;
<img src="docs/query.png" width="820" alt="Asking a question in plain English" />
</div>

## Why Strata?

There are plenty of Postgres GUIs. Strata is deliberately narrow: **the fastest
way to look something up — or fix one row — in Postgres on a Mac, without writing
SQL.** It's the quick counterpart to pgAdmin, not a universal IDE.

|  | Strata | pgAdmin | TablePlus | Postico | DBeaver |
|---|:---:|:---:|:---:|:---:|:---:|
| Price | **Free** | Free | $99+/device | Paid | Free CE |
| Open source | **✓ (MIT)** | ✓ | ✗ | ✗ | ✓ |
| Truly Mac-native (no Electron/Java/web) | **✓** | ✗ (web) | ✓ | ✓ | ✗ (Java) |
| Postgres-focused | **✓** | ✓ | ✗ (multi-DB) | ✓ | ✗ (multi-DB) |
| AI SQL with **no API key** | **✓** | ✗ | ✗ | ✗ | ✗ |
| Interactive schema ER map | **✓** | partial | ✗ | ✗ | ✓ |
| Transaction-safe inline edits | **✓** | partial | ✓ | ✓ | ✓ |

**The differentiators that matter:**

- **No-API-key AI** — plain-English → SQL rides your *existing* Claude Code or
  Codex CLI sign-in. No key to paste, no per-token bill. (Don't have either? The
  AI bar just hides; everything else works.)
- **Safe by construction** — inline edits stage locally and commit in a single
  transaction that rolls back unless every row matches its primary key exactly
  once, so a slip can't quietly rewrite a table. EXPLAIN ANALYZE always runs
  inside `BEGIN`/`ROLLBACK` — safe even on writes.
- **Lookup-first** — pick a connection, click a table, your data's on screen.
  Filter and sort with buttons, not boilerplate.

**Honest limits:** macOS-only, Postgres-only, and not yet code-signed (a one-time
`xattr -cr` on first launch — see [Install](#install)). If you need Windows/Linux
or many database engines, [DBeaver](https://dbeaver.io) or
[Beekeeper Studio](https://www.beekeeperstudio.io) are better fits.

## Build from source

Built with **Tauri 2 + React 19 + Tailwind 4**, talking to Postgres over
tokio-postgres on the simple-query protocol. Uses [Bun](https://bun.sh).

```sh
bun install
bun run app           # dev, hot reload (opens the window)
bun run install-app   # release build → /Applications/Strata.app (this Mac)
bun run dev           # browser-only UI against fictional demo data
```

### Package a universal DMG to share

```sh
bun run dist
# → dist-dmg/Strata_<version>_universal.dmg
```

This builds a universal (Intel + Apple Silicon) app and wraps it in a disk
image with `hdiutil`. To drop the Gatekeeper step for recipients entirely, sign
and notarize the build with an Apple Developer ID certificate.

> **AI SQL** needs either the [Claude CLI](https://claude.com/claude-code) or the
> Codex CLI installed and signed in. Choose the provider in Settings. Without a
> selected CLI the app works fully — the *Ask AI* bar is just hidden.

## Support

If Strata saves you time, you can buy me a coffee — it keeps the releases coming.

<a href="https://buymeacoffee.com/benoneill"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=benoneill&button_colour=5F7FFF&font_colour=ffffff&font_family=Arial&outline_colour=000000&coffee_colour=FFDD00" alt="Buy me a coffee" height="40" /></a>

## Storage

Connection profile metadata and prefs live in
`~/Library/Application Support/app.strata.desktop/settings.json`. Passwords are
stored separately in the macOS Keychain under the `Strata` service.

## License

[MIT](LICENSE) © Ben O'Neill. Free to use, fork, and build on.
