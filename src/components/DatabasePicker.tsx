import { useState } from "react";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { Icon } from "../lib/icons";
import { Spinner, toast } from "./ui";

/** Switch the active database on a connected server. The database list comes
    from pg_database (cluster-wide, so it's fetched once per connection); the
    switch reopens the underlying connection against the chosen database. */
export function DatabasePicker({
  connId,
  database,
  onSwitch,
  style,
}: {
  connId: string;
  database: string;
  onSwitch: (db: string) => Promise<void>;
  style?: React.CSSProperties;
}) {
  const dbs = useAsync(() => api.listDatabases(connId), [connId]);
  const [busy, setBusy] = useState(false);

  async function change(db: string) {
    if (db === database || busy) return;
    setBusy(true);
    try {
      await onSwitch(db);
      toast(`Switched to ${db}`, "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const list = dbs.data ?? [];
  return (
    <div style={{ position: "relative", ...style }}>
      <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: busy ? "var(--accent)" : "var(--muted)", display: "flex", pointerEvents: "none" }}>
        {busy ? <Spinner size={13} /> : <Icon.database w={13} />}
      </span>
      <select
        className="input"
        style={{ padding: "8px 10px 8px 30px", fontSize: 13, appearance: "none" }}
        value={database}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        title="Active database"
      >
        {!list.includes(database) && <option value={database}>{database}</option>}
        {list.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <span style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", display: "flex", pointerEvents: "none" }}>
        <Icon.chevDown w={12} />
      </span>
    </div>
  );
}
