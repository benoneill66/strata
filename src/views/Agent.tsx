import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { Icon } from "../lib/icons";
import type { AgentEvent, AiProvider, ChatMsg } from "../lib/types";
import { CopyBtn, Empty, Spinner, toast } from "../components/ui";

/** A query the agent ran during a turn (the "step" event), kept on the message
 *  so it re-renders with history. */
type Step = Extract<AgentEvent, { type: "step" }>;
type Msg = { role: "user" | "assistant"; content: string; steps?: Step[] };
type Chat = { id: string; title: string; messages: Msg[]; createdAt: number };

const KEY = (connId: string) => `strata.agent-chats.${connId}`;

function loadChats(connId: string): Chat[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(connId)) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function whenLabel(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

export function Agent({
  connId,
  database,
  aiProvider,
  hasConnections,
  onNew,
}: {
  connId: string | null;
  database: string | null;
  aiProvider: AiProvider;
  hasConnections: boolean;
  onNew: () => void;
}) {
  const ai = useAsync(() => api.aiStatus(), [aiProvider]);
  const schemas = useAsync(() => (connId ? api.listSchemas(connId) : Promise.resolve([])), [connId]);

  const [chats, setChats] = useState<Chat[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [schema, setSchema] = useState<string>(""); // "" = all schemas
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  // In-flight turn: tokens accumulate in refs (synchronous for the final commit)
  // and mirror to state for rendering.
  const [streaming, setStreaming] = useState(false);
  const [liveAnswer, setLiveAnswer] = useState("");
  const [liveSteps, setLiveSteps] = useState<Step[]>([]);
  const answerRef = useRef("");
  const stepsRef = useRef<Step[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const currentChat = useMemo(() => chats.find((c) => c.id === currentId) ?? null, [chats, currentId]);

  // Load this connection's chat history when the connection changes.
  useEffect(() => {
    if (!connId) {
      setChats([]);
      setCurrentId(null);
      return;
    }
    const loaded = loadChats(connId);
    setChats(loaded);
    setCurrentId(loaded[0]?.id ?? null);
  }, [connId]);

  // Persist on every mutation (not via an effect — avoids clobbering storage
  // with the initial empty state before the load effect runs).
  function commitChats(next: Chat[]) {
    setChats(next);
    if (connId) localStorage.setItem(KEY(connId), JSON.stringify(next));
  }
  const patchChat = (id: string, fn: (c: Chat) => Chat) =>
    setChats((prev) => {
      const next = prev.map((c) => (c.id === id ? fn(c) : c));
      if (connId) localStorage.setItem(KEY(connId), JSON.stringify(next));
      return next;
    });

  function newChat() {
    setCurrentId(null);
    setInput("");
    setError(null);
  }

  function deleteChat(id: string) {
    const next = chats.filter((c) => c.id !== id);
    commitChats(next);
    if (currentId === id) setCurrentId(next[0]?.id ?? null);
  }

  // Auto-scroll as the conversation grows / streams.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [currentChat?.messages.length, liveAnswer, liveSteps.length, streaming]);

  async function send() {
    const text = input.trim();
    if (!text || !connId || streaming) return;

    const userMsg: Msg = { role: "user", content: text };
    let chat = currentChat;
    if (!chat) {
      chat = { id: crypto.randomUUID(), title: text.slice(0, 64), messages: [userMsg], createdAt: Date.now() };
      commitChats([chat, ...chats]);
      setCurrentId(chat.id);
    } else {
      chat = { ...chat, messages: [...chat.messages, userMsg] };
      patchChat(chat.id, () => chat!);
    }
    const chatId = chat.id;
    const apiMessages: ChatMsg[] = chat.messages.map((m) => ({ role: m.role, content: m.content }));

    setInput("");
    setError(null);
    answerRef.current = "";
    stepsRef.current = [];
    setLiveAnswer("");
    setLiveSteps([]);
    setStreaming(true);

    try {
      await api.agentChat(connId, schema || null, apiMessages, (e) => {
        if (e.type === "step") {
          stepsRef.current = [...stepsRef.current, e];
          setLiveSteps(stepsRef.current);
        } else if (e.type === "token") {
          answerRef.current += e.text;
          setLiveAnswer(answerRef.current);
        } else if (e.type === "error") {
          setError(e.message);
        }
        // "done" is implied by the promise resolving.
      });
      const aiMsg: Msg = {
        role: "assistant",
        content: answerRef.current.trim() || "(no answer)",
        steps: stepsRef.current.length ? stepsRef.current : undefined,
      };
      patchChat(chatId, (c) => ({ ...c, messages: [...c.messages, aiMsg] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(msg, "error");
    } finally {
      setStreaming(false);
      answerRef.current = "";
      stepsRef.current = [];
      setLiveAnswer("");
      setLiveSteps([]);
    }
  }

  if (!connId) {
    return hasConnections ? (
      <Empty
        title="Choose a connection"
        sub="Pick a server from the list on the left to connect, then chat with your database here."
        icon={<Icon.sparkles w={22} />}
      />
    ) : (
      <Empty
        title="No connections yet"
        sub="Add a Postgres server from the sidebar, then ask questions about your data in plain language."
        icon={<Icon.sparkles w={22} />}
        action={<button className="btn btn-primary" onClick={onNew}><Icon.plus w={13} /> New connection</button>}
      />
    );
  }

  const thread = currentChat?.messages ?? [];
  const showGreeting = thread.length === 0 && !streaming;

  return (
    <div className="fade" style={{ display: "flex", gap: 12, height: "100%", minHeight: 0 }}>
      {/* ---------- left rail: schema + chats ---------- */}
      <div style={{ width: 210, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
        <div>
          <span className="label" style={{ letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>Schema</span>
          <select
            className="input"
            style={{ width: "100%", padding: "7px 10px", fontSize: 12.5 }}
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
          >
            <option value="">All schemas</option>
            {(schemas.data ?? []).map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>

        <button className="btn" style={{ justifyContent: "center" }} onClick={newChat}>
          <Icon.plus w={13} /> New chat
        </button>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3, minHeight: 0 }}>
          {chats.length === 0 && (
            <div style={{ fontSize: 11.5, color: "var(--muted)", padding: "8px 10px", lineHeight: 1.5 }}>
              No conversations yet.
            </div>
          )}
          {chats.map((c) => (
            <div
              key={c.id}
              className={`tbl-item ${c.id === currentId ? "active" : ""}`}
              style={{ flexDirection: "column", alignItems: "stretch", gap: 2, height: "auto", padding: "8px 10px" }}
              onClick={() => { setCurrentId(c.id); setError(null); }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="nm" style={{ color: c.id === currentId ? "var(--text)" : undefined, fontWeight: 560 }}>{c.title}</span>
                <span
                  className="no-drag"
                  style={{ display: "flex", opacity: 0.45 }}
                  title="Delete chat"
                  onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}
                >
                  <Icon.trash w={12} />
                </span>
              </div>
              <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{whenLabel(c.createdAt)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ---------- right pane: thread + composer ---------- */}
      <div className="glass-card" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
        {ai.data && !ai.data.available && (
          <div style={{ padding: "9px 14px", fontSize: 12, color: "#ffb3c1", background: "rgba(255,93,122,0.10)", borderBottom: "1px solid rgba(255,93,122,0.25)", display: "flex", alignItems: "center", gap: 8 }}>
            <Icon.alert w={14} /> No AI CLI detected — set it up in Settings to chat with your database.
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
          {showGreeting && (
            <div style={{ margin: "auto", textAlign: "center", color: "var(--muted)", maxWidth: 440 }}>
              <div style={{ opacity: 0.5, display: "flex", justifyContent: "center", marginBottom: 12 }}><Icon.sparkles w={26} /></div>
              <div style={{ fontSize: 15, fontWeight: 620, color: "var(--text)" }}>Ask about {database ?? "your database"}</div>
              <div style={{ fontSize: 12.8, marginTop: 6, lineHeight: 1.55 }}>
                The agent runs read-only queries for you and answers in plain language — e.g. “does the user with email x@y.com exist, and is anything wrong with their data?”
              </div>
            </div>
          )}

          {thread.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="agent-bubble-user">{m.content}</div>
            ) : (
              <div key={i} className="agent-bubble-ai" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <StepList steps={m.steps ?? []} />
                <div className="agent-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>
              </div>
            )
          )}

          {streaming && (
            <div className="agent-bubble-ai" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <StepList steps={liveSteps} />
              {liveAnswer ? (
                <div className="agent-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{liveAnswer}</ReactMarkdown>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 12.5 }}>
                  <Spinner size={13} /> {liveSteps.length ? "Reading results…" : "Thinking…"}
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12.5, color: "var(--error)", fontFamily: "SF Mono, ui-monospace, monospace", lineHeight: 1.5 }}>{error}</div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* composer */}
        <div style={{ borderTop: "1px solid var(--hair-soft)", padding: 12, display: "flex", alignItems: "flex-end", gap: 8 }}>
          <textarea
            className="textarea input"
            style={{ flex: 1, height: 44, minHeight: 44, maxHeight: 140, fontFamily: "inherit", fontSize: 13, padding: "11px 13px" }}
            placeholder="Ask about your database…"
            value={input}
            disabled={streaming || (ai.data && !ai.data.available) || false}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button
            className="btn btn-primary"
            style={{ height: 44, width: 44, padding: 0, justifyContent: "center", flexShrink: 0 }}
            disabled={streaming || !input.trim()}
            onClick={send}
            title="Send (Enter)"
          >
            {streaming ? <Spinner size={15} /> : <Icon.play w={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Collapsible chips for the read-only queries the agent ran this turn. */
function StepList({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {steps.map((s, i) => <StepChip key={i} step={s} />)}
    </div>
  );
}

function StepChip({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const err = step.error;
  const label = err
    ? (err.startsWith("Rejected") ? "Query rejected (read-only)" : "Query failed")
    : `Ran query · ${step.row_count.toLocaleString()} row${step.row_count === 1 ? "" : "s"}${step.truncated ? "+" : ""}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className={`agent-step ${err ? "err" : ""}`} style={{ cursor: "default", width: "fit-content" }} onClick={() => setOpen((o) => !o)}>
        {err ? <Icon.alert w={12} /> : <Icon.zap w={12} />}
        {label}
        <Icon.chevDown w={11} />
      </span>
      {open && (
        <div className="glass-card" style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
          <code className="mono" style={{ fontSize: 11.5, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text)" }}>{step.sql}</code>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <CopyBtn text={step.sql} label="Copy SQL" />
            {err && <span style={{ fontSize: 11.5, color: "#ffb3c1" }}>{err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
