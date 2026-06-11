import { useEffect, useState } from "react";
import { IS_TAURI, browserDownload, saveDialog } from "../lib/api";
import { EXPORT_FORMATS, renderExport } from "../lib/export";
import type { ExportFormat } from "../lib/export";
import type { QueryResult } from "../lib/types";
import { Icon } from "../lib/icons";
import { Spinner, toast } from "./ui";

const basename = (p: string) => p.split(/[\\/]/).pop() || p;
const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_");

/**
 * Export button + format dropdown. In the desktop app it opens a native save
 * dialog then hands the path to `run`, which fetches the full (uncapped) result
 * set in Rust. In browser/demo mode it serializes the in-memory `result` and
 * downloads it. `sqlTable` is the quoted INSERT target for the SQL format.
 */
export function ExportMenu({
  result,
  baseName,
  sqlTable,
  run,
  disabled,
}: {
  result: QueryResult | null;
  baseName: string;
  sqlTable: string;
  run: (format: ExportFormat, path: string) => Promise<number>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function pick(fmt: ExportFormat) {
    const meta = EXPORT_FORMATS.find((f) => f.id === fmt)!;
    const filename = `${safeName(baseName)}.${meta.ext}`;
    try {
      if (IS_TAURI) {
        const path = await saveDialog(filename, meta.ext);
        if (!path) {
          setOpen(false);
          return;
        }
        setBusy(fmt);
        const n = await run(fmt, path);
        toast(`Exported ${n.toLocaleString()} row${n === 1 ? "" : "s"} → ${basename(path)}`, "ok");
      } else {
        if (!result) return;
        browserDownload(filename, renderExport(fmt, result, sqlTable), meta.mime);
        toast(`Exported ${result.rows.length.toLocaleString()} rows → ${filename}`, "ok");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
      setOpen(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button className="btn btn-sm" disabled={disabled || busy !== null} onClick={() => setOpen((v) => !v)}>
        {busy ? <Spinner size={13} /> : <Icon.download w={13} />} Export <Icon.chevDown w={11} />
      </button>
      {open && (
        <>
          <div className="conn-menu-scrim" onClick={() => setOpen(false)} />
          <div className="conn-menu" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: 168 }}>
            {EXPORT_FORMATS.map((f) => (
              <div key={f.id} className="conn-menu-item" onClick={() => pick(f.id)}>
                <span style={{ display: "flex", opacity: 0.65 }}><Icon.download w={13} /></span>
                <span style={{ flex: 1, fontSize: 12.5 }}>{f.label}</span>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>.{f.ext}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
