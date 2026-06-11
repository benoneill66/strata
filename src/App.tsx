import { useCallback, useEffect, useState } from "react";
import { api, IS_TAURI, startWindowDrag, toggleMaximize } from "./lib/api";
import type { ConnectionProfile, DbInfo, Settings as SettingsType } from "./lib/types";
import { Sidebar, type ViewId } from "./components/Sidebar";
import { ConnectionDialog, blankProfile } from "./components/ConnectionDialog";
import { Toaster, toast } from "./components/ui";
import { Browse } from "./views/Browse";
import { Query } from "./views/Query";
import { Settings } from "./views/Settings";

export default function App() {
  const [view, setView] = useState<ViewId>("browse");
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [connected, setConnected] = useState<Record<string, DbInfo>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Add/edit connection dialog (was a full-screen tab; now a modal from the rail).
  const [editing, setEditing] = useState<ConnectionProfile | null>(null);
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    if (!IS_TAURI) document.body.classList.add("no-native");
    api.getSettings().then(setSettings).catch(() => setSettings({ connections: [], row_limit: 200 }));
  }, []);

  const saveSettings = useCallback(async (s: SettingsType) => {
    setSettings(s);
    await api.saveSettings(s);
  }, []);

  const connect = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      const info = await api.connectDb(id);
      setConnected((c) => ({ ...c, [id]: info }));
      setActiveId(id);
      setView((v) => (v === "settings" ? "browse" : v));
      toast(`Connected — PostgreSQL ${info.version}`, "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusyId(null);
    }
  }, []);

  // The shared global connection: clicking a server connects it (or, if already
  // live, just makes it the active one) without leaving Browse/Query.
  const select = useCallback(
    (id: string) => {
      if (busyId) return;
      if (connected[id]) {
        setActiveId(id);
        setView((v) => (v === "settings" ? "browse" : v));
      } else {
        void connect(id);
      }
    },
    [busyId, connected, connect]
  );

  const switchDatabase = useCallback(async (id: string, database: string) => {
    const info = await api.switchDatabase(id, database);
    setConnected((c) => ({ ...c, [id]: info }));
  }, []);

  const disconnect = useCallback(async (id: string) => {
    await api.disconnectDb(id);
    setConnected((c) => {
      const next = { ...c };
      delete next[id];
      return next;
    });
    setActiveId((a) => (a === id ? null : a));
  }, []);

  const saveProfile = useCallback(
    async (p: ConnectionProfile) => {
      if (!settings) return;
      const i = settings.connections.findIndex((c) => c.id === p.id);
      const connections =
        i >= 0 ? settings.connections.map((c) => (c.id === p.id ? p : c)) : [...settings.connections, p];
      await saveSettings({ ...settings, connections });
      setEditing(null);
      toast(`Saved “${p.name || p.host}”`, "ok");
    },
    [settings, saveSettings]
  );

  const deleteProfile = useCallback(
    async (p: ConnectionProfile) => {
      if (!settings) return;
      if (connected[p.id]) await disconnect(p.id);
      await saveSettings({ ...settings, connections: settings.connections.filter((c) => c.id !== p.id) });
      setEditing(null);
    },
    [settings, connected, disconnect, saveSettings]
  );

  const newConnection = useCallback(() => { setEditing(blankProfile()); setIsNew(true); }, []);
  const editConnection = useCallback((p: ConnectionProfile) => { setEditing({ ...p }); setIsNew(false); }, []);

  if (!settings) return null;

  const activeInfo = activeId ? connected[activeId] ?? null : null;
  const hasConnections = settings.connections.length > 0;

  return (
    <div style={{ display: "flex", height: "100%", position: "relative" }}>
      <div className="aurora" />

      <Sidebar
        view={view}
        setView={setView}
        connections={settings.connections}
        connected={connected}
        activeId={activeId}
        busyId={busyId}
        onSelect={select}
        onDisconnect={disconnect}
        onEdit={editConnection}
        onNew={newConnection}
      />

      <main
        onMouseDown={startWindowDrag}
        onDoubleClick={(e) => { if ((e.target as HTMLElement).closest("button,input,select,textarea,.no-drag")) return; toggleMaximize(); }}
        style={{ flex: 1, minWidth: 0, padding: "52px 18px 16px 4px", position: "relative", zIndex: 1, display: "flex", flexDirection: "column" }}
      >
        {/* Browse and Query stay mounted so table selection, filters and SQL
            survive switching views; only the active one is displayed. */}
        <div className="glass-card no-drag" style={{ flex: 1, minHeight: 0, borderRadius: 22, padding: 18, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ display: view === "browse" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <Browse
              connId={activeId && activeInfo ? activeId : null}
              database={activeInfo?.database ?? null}
              defaultLimit={settings.row_limit}
              hasConnections={hasConnections}
              onNew={newConnection}
              onSwitchDatabase={switchDatabase}
            />
          </div>
          <div style={{ display: view === "query" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <Query
              connId={activeId && activeInfo ? activeId : null}
              database={activeInfo?.database ?? null}
              hasConnections={hasConnections}
              onNew={newConnection}
              onSwitchDatabase={switchDatabase}
            />
          </div>
          <div style={{ display: view === "settings" ? "block" : "none", overflowY: "auto", flex: 1, minHeight: 0 }}>
            <Settings settings={settings} onSettings={saveSettings} />
          </div>
        </div>
      </main>

      {editing && (
        <ConnectionDialog
          profile={editing}
          isNew={isNew}
          onSave={saveProfile}
          onDelete={deleteProfile}
          onClose={() => setEditing(null)}
        />
      )}

      <Toaster />
    </div>
  );
}
