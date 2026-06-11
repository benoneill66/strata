import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../lib/icons";

// ---------- toast pub/sub (no context plumbing) ----------
type Toast = { id: number; msg: string; tone: "ok" | "error" | "info" };
const listeners = new Set<(t: Toast) => void>();
let seq = 1;
export function toast(msg: string, tone: Toast["tone"] = "info") {
  const t = { id: seq++, msg, tone };
  listeners.forEach((l) => l(t));
}
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (t: Toast) => {
      setItems((s) => [...s, t]);
      window.setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), 5200);
    };
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, []);
  if (!items.length) return null;
  const color = (tone: Toast["tone"]) => (tone === "ok" ? "var(--ok)" : tone === "error" ? "var(--error)" : "var(--accent)");
  return (
    <div style={{ position: "fixed", bottom: 22, right: 22, zIndex: 2000, display: "flex", flexDirection: "column", gap: 10, width: 340, maxWidth: "calc(100vw - 44px)" }}>
      {items.map((t) => (
        <div key={t.id} className="glass-card rise no-drag" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}
          style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", boxShadow: "0 14px 44px rgba(0,0,0,0.5)" }}>
          <span style={{ color: color(t.tone), display: "flex" }}>
            {t.tone === "error" ? <Icon.alert w={16} /> : t.tone === "ok" ? <Icon.check w={16} /> : <Icon.layers w={16} />}
          </span>
          <span style={{ fontSize: 12.8, fontWeight: 550, flex: 1, lineHeight: 1.4 }}>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- spinner ----------
export function Spinner({ size = 15 }: { size?: number }) {
  return <span className="spin" style={{ display: "inline-flex" }}><Icon.refresh w={size} /></span>;
}

// ---------- empty state ----------
export function Empty({ title, sub, icon, action }: { title: string; sub?: string; icon?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="glass-card rise" style={{ padding: "44px 24px", textAlign: "center" }}>
      <div style={{ opacity: 0.45, display: "flex", justifyContent: "center", marginBottom: 12 }}>{icon ?? <Icon.database w={22} />}</div>
      <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
      {sub && <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4, maxWidth: 420, marginInline: "auto", lineHeight: 1.5 }}>{sub}</div>}
      {action && <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>{action}</div>}
    </div>
  );
}

// ---------- loading rows ----------
export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="glass-card" style={{ height: 64, opacity: 0.5 - i * 0.07 }} />
      ))}
    </div>
  );
}

// ---------- dialog ----------
export function Dialog({ title, children, onClose, width = 440 }: { title: string; children: React.ReactNode; onClose: () => void; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Portal to <body>: animated ancestors (.rise) become the containing block
  // for position:fixed in WKWebView, clipping the overlay to the content card.
  return createPortal(
    <div className="drawer-scrim no-drag" style={{ display: "grid", placeItems: "center" }} onClick={onClose}>
      <div className="glass-card rise" style={{ width, maxWidth: "92vw", maxHeight: "88vh", overflow: "auto", padding: 0, background: "rgba(16,19,28,0.96)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px 12px" }}>
          <div style={{ fontSize: 15, fontWeight: 680 }}>{title}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: 6 }}><Icon.close w={15} /></button>
        </div>
        <div style={{ padding: "0 18px 18px" }}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

// ---------- copy button ----------
export function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      {done ? <Icon.check w={13} /> : <Icon.copy />} {label ?? (done ? "Copied" : "Copy")}
    </button>
  );
}
