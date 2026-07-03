import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  createChatSession,
  fetchChatMessages,
  fetchChatSessions,
  streamChatMessage,
  type ChatMessageRow,
  type ChatSessionRow,
} from "./api";
import { CloseIcon, ExternalIcon } from "./icons";

/** Render assistant text with ONLY [label](https://…) markdown links converted to anchors —
 *  everything else stays plain text (no markdown lib, no innerHTML). */
function renderWithLinks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a key={k++} className="rule-link" href={m[2]} target="_blank" rel="noreferrer noopener">
        {m[1]} <ExternalIcon />
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const TOOL_LABEL: Record<string, string> = {
  mcp__keeper__search_waters: "Searching waters…",
  mcp__keeper__get_water_rules: "Reading the regulations…",
  mcp__keeper__search_regulations: "Searching regulation text…",
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ChatPanel({ open, onClose }: Props) {
  const [sessions, setSessions] = useState<ChatSessionRow[] | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<string | null>(null); // streaming assistant text
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Monotonic temp ids for optimistic bubbles — negative so they can never collide
  // with real (positive, serial) DB ids, and counter-based so two turns can never
  // collide with each other (Date.now() can repeat under coarse timers).
  const tempIdRef = useRef(-1);

  // Refetch whenever the list view is showing (open, no active chat) and we don't
  // have a loaded list — "← Chats" and startNew() set sessions to null to land here,
  // so returning from a conversation always reflects fresh updatedAt ordering.
  useEffect(() => {
    if (!open || active != null || sessions !== null) return;
    const ac = new AbortController();
    fetchChatSessions(ac.signal).then(setSessions).catch(() => { if (!ac.signal.aborted) setSessions([]); });
    return () => ac.abort();
  }, [open, active, sessions]);

  useEffect(() => {
    if (active == null) return;
    const ac = new AbortController();
    fetchChatMessages(active, ac.signal).then(setMessages).catch(() => setMessages([]));
    return () => ac.abort();
  }, [active]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, live]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const startNew = useCallback(async () => {
    setError(null);
    try {
      const s = await createChatSession();
      setSessions(null);
      setActive(s.id);
      setMessages([]);
    } catch {
      // 401 already re-locks the app via keeper:unauthorized; anything else surfaces here.
      setError("Couldn’t start a new chat — try again.");
    }
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy || active == null) return;
    setDraft("");
    setError(null);
    setBusy(true);
    setMessages((m) => [...m, { id: tempIdRef.current--, role: "user", content: text, createdAt: "" }]);
    setLive("");
    let acc = "";
    try {
      await streamChatMessage(active, text, {
        onTool: (name) => setToolNote(TOOL_LABEL[name] ?? "Looking that up…"),
        onDelta: (t) => { acc += t; setToolNote(null); setLive(acc); },
        onDone: () => {
          setMessages((m) => [...m, { id: tempIdRef.current--, role: "assistant", content: acc, createdAt: "" }]);
          setLive(null);
        },
        onError: (message) => { setError(message); setLive(null); },
      });
    } catch {
      setError("Couldn’t reach the chat service.");
      setLive(null);
    } finally {
      setToolNote(null);
      setBusy(false);
    }
  }, [draft, busy, active]);

  if (!open) return null;

  return (
    <section className="chat-panel" role="dialog" aria-modal="false" aria-label="Regulations chat">
      <div className="chat-head">
        {active != null ? (
          <button className="stocked-back" onClick={() => { setActive(null); setSessions(null); }}>← Chats</button>
        ) : (
          <h2 className="stocked-title">Ask Keeper</h2>
        )}
        <button className="sheet-close stocked-close" aria-label="Close chat" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>

      {active == null && (
        <>
          <button className="chat-new" onClick={startNew}>+ New chat</button>
          {error && <div className="chat-error" role="alert">{error}</div>}
          <ul className="stocked-list">
            {(sessions ?? []).map((s) => (
              <li key={s.id}>
                <button className="stocked-row" onClick={() => setActive(s.id)}>
                  <span className="stocked-species-name">{s.title}</span>
                  <span className="stocked-meta">{s.messageCount} message{s.messageCount === 1 ? "" : "s"}</span>
                </button>
              </li>
            ))}
            {sessions?.length === 0 && <li className="stocked-empty">No chats yet — start one.</li>}
            {sessions === null && <li className="stocked-empty">Loading…</li>}
          </ul>
        </>
      )}

      {active != null && (
        <>
          <div className="chat-body" ref={bodyRef}>
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg chat-msg--${m.role}`}>
                {m.role === "assistant" ? renderWithLinks(m.content) : m.content}
              </div>
            ))}
            {toolNote && <div className="chat-tool-note">{toolNote}</div>}
            {live !== null && <div className="chat-msg chat-msg--assistant">{renderWithLinks(live)}</div>}
            {error && <div className="chat-error" role="alert">{error}</div>}
            {messages.length === 0 && live === null && (
              <p className="stocked-empty">Ask about seasons, limits, licenses, or stocking — answers cite the actual regulation.</p>
            )}
          </div>
          <form className="chat-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input
              className="chat-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Can I keep trout at Donner Lake?"
              maxLength={2000}
              aria-label="Chat message"
            />
            <button className="chat-send" type="submit" disabled={busy || !draft.trim()}>Send</button>
          </form>
        </>
      )}
    </section>
  );
}
