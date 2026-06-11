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

<img src="docs/browse.png" width="860" alt="Browsing a table in Strata" />

</div>

## Install

**[⬇︎ Download the latest `.dmg`](https://github.com/benoneill66/strata/releases/latest)** — universal, runs on both Intel and Apple Silicon Macs.

1. Open the `.dmg` and drag **Strata** into **Applications**.
2. First launch only — the app isn't signed with an Apple Developer ID yet, so
   clear the quarantine flag once:
   ```sh
   xattr -cr /Applications/Strata.app
   ```
   *(or right-click Strata → **Open** → **Open**).* After that, just double-click it.

## Features

- **Connections** — saved profiles (host, user, database, SSL mode) live in a
  persistent sidebar rail, shared across Browse and Query. One-click connect with
  a built-in connection test; multiple live servers at once.
- **Browse** — schema/table tree with row estimates, an instant data grid with
  column sorting, stackable filters (contains / = / ≠ / ranges / null), exact
  counts on demand, pagination, a structure tab (types, PKs, defaults) and a
  row-detail drawer with copy-as-JSON.
- **Schema** — an interactive ER diagram of the whole schema: force-laid-out
  table cards with primary/foreign-key markers and foreign-key edges. Pan, zoom,
  drag, search, and click a table to light up everything it links to. Toggle
  between table-only, key-columns or all-columns detail; orphan tables are
  parked in a tidy grid.
- **Query** — SQL editor (⌘↩ to run) for multi-statement scripts, result grid,
  elapsed/row chips, copy-as-CSV, and local query history.
- **Ask AI** — type a question in plain English and Strata writes the SQL from
  your live schema, dropping it into the editor and auto-running read-only
  queries. Powered by your local Claude CLI sign-in — no API key.
- **Native feel** — transparent vibrancy window, hidden title bar, dark glass UI.
  No Electron.

<div align="center">
<img src="docs/schema.png" width="820" alt="The interactive schema explorer" />
&nbsp;
<img src="docs/query.png" width="820" alt="Asking a question in plain English" />
</div>

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

> **AI SQL** needs the [Claude CLI](https://claude.com/claude-code) installed and
> signed in. Without it the app works fully — the *Ask AI* bar is just hidden.

## Storage

Connection profiles (passwords included, plaintext like `pgpass`) and prefs live
in `~/Library/Application Support/app.strata.desktop/settings.json`.
