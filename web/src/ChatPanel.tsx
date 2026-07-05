import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  checkChatAuth,
  clearPassword,
  createChatSession,
  fetchChatMessages,
  fetchChatSessions,
  getStoredPassword,
  storePassword,
  streamChatMessage,
  type ChatCard as ChatCardData,
  type ChatMessageRow,
  type ChatSessionRow,
} from "./api";
import { ChatCard } from "./ChatCard";
import { CloseIcon, ExternalIcon } from "./icons";

/** Inline markdown: **bold** and [label](https://…) links only — no lib, no innerHTML. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Alternate on bold spans, then linkify each plain segment.
  const boldRe = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  const pushLinked = (s: string) => {
    const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let l = 0;
    let lm: RegExpExecArray | null;
    while ((lm = re.exec(s)) !== null) {
      if (lm.index > l) out.push(s.slice(l, lm.index));
      out.push(
        <a key={`${keyBase}-a${k++}`} className="rule-link" href={lm[2]} target="_blank" rel="noreferrer noopener">
          {lm[1]} <ExternalIcon />
        </a>,
      );
      l = lm.index + lm[0].length;
    }
    if (l < s.length) out.push(s.slice(l));
  };
  while ((m = boldRe.exec(text)) !== null) {
    if (m.index > last) pushLinked(text.slice(last, m.index));
    out.push(<strong key={`${keyBase}-b${k++}`}>{renderInline(m[1], `${keyBase}-b${k}`)}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) pushLinked(text.slice(last));
  return out;
}

/** Light markdown → React: headings (#), bullet lists (- / *), bold, links, paragraphs.
 *  Deliberately small — the heavy structured data renders as its own cards, not as markdown. */
function renderMarkdown(text: string): ReactNode[] {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flushList = () => {
    if (list.length) { blocks.push(<ul key={`ul${blocks.length}`} className="chat-md-ul">{list}</ul>); list = []; }
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const h = /^\s{0,3}#{1,4}\s+(.*)$/.exec(line);
    const b = /^\s*[-*]\s+(.*)$/.exec(line);
    if (h) { flushList(); blocks.push(<div key={i} className="chat-md-h">{renderInline(h[1], `h${i}`)}</div>); }
    else if (b) { list.push(<li key={i}>{renderInline(b[1], `li${i}`)}</li>); }
    else if (line.trim() === "") { flushList(); }
    else { flushList(); blocks.push(<p key={i} className="chat-md-p">{renderInline(line, `p${i}`)}</p>); }
  });
  flushList();
  return blocks;
}

const TOOL_LABEL: Record<string, string> = {
  mcp__keeper__search_waters: "Searching waters…",
  mcp__keeper__get_water_rules: "Reading the regulations…",
  mcp__keeper__get_stocking_history: "Pulling stocking history…",
  mcp__keeper__search_regulations: "Searching regulation text…",
  WebSearch: "Searching the web…",
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fly the map to a water by name and open its rules sheet (also closes the chat). */
  onOpenWater: (name: string) => void;
}

const SUGGESTIONS = [
  "Can I keep trout at Donner Lake right now?",
  "What's been stocked at Sparks Marina, and when?",
  "Which waters near Truckee are catch-and-release only?",
];

export function ChatPanel({ open, onClose, onOpenWater }: Props) {
  const [sessions, setSessions] = useState<ChatSessionRow[] | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<string | null>(null); // streaming assistant text
  const [liveCards, setLiveCards] = useState<ChatCardData[]>([]);
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Chat is the one password-gated feature (the rest of the app is public). null = checking.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pwWrong, setPwWrong] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tempIdRef = useRef(-1);

  // Verify the chat password when the panel opens (probe the gate with any stored value).
  useEffect(() => {
    if (!open) return;
    if (!getStoredPassword()) { setAuthed(false); return; }
    const ac = new AbortController();
    checkChatAuth(ac.signal).then((ok) => setAuthed(ok));
    return () => ac.abort();
  }, [open]);

  // A 401 from any chat request re-locks (api.ts clears the password + dispatches this).
  useEffect(() => {
    const relock = () => { setAuthed(false); setPwWrong(false); };
    window.addEventListener("keeper:unauthorized", relock);
    return () => window.removeEventListener("keeper:unauthorized", relock);
  }, []);

  const unlock = useCallback(async (pw: string) => {
    if (!pw) return;
    storePassword(pw);
    setPwWrong(false);
    const ok = await checkChatAuth();
    if (ok) setAuthed(true);
    else { clearPassword(); setPwWrong(true); }
  }, []);

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
  }, [messages, live, liveCards]);

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
      setError("Couldn’t start a new chat — try again.");
    }
  }, []);

  const send = useCallback(async (textIn?: string) => {
    const text = (textIn ?? draft).trim();
    if (!text || busy || active == null) return;
    setDraft("");
    setError(null);
    setBusy(true);
    setMessages((m) => [...m, { id: tempIdRef.current--, role: "user", content: text, createdAt: "" }]);
    setLive("");
    setLiveCards([]);
    let acc = "";
    const cards: ChatCardData[] = [];
    try {
      await streamChatMessage(active, text, {
        onTool: (name) => setToolNote(TOOL_LABEL[name] ?? "Looking that up…"),
        onCard: (card) => { cards.push(card); setLiveCards([...cards]); },
        onDelta: (t) => { acc += t; setToolNote(null); setLive(acc); },
        onDone: () => {
          setMessages((m) => [...m, { id: tempIdRef.current--, role: "assistant", content: acc, cards: [...cards], createdAt: "" }]);
          setLive(null);
          setLiveCards([]);
        },
        onError: (message) => { setError(message); setLive(null); setLiveCards([]); },
      });
    } catch {
      setError("Couldn’t reach the chat service.");
      setLive(null);
      setLiveCards([]);
    } finally {
      setToolNote(null);
      setBusy(false);
    }
  }, [draft, busy, active]);

  if (!open) return null;

  // Chat password gate — the only locked feature. Shown until the password validates.
  if (authed !== true) {
    return (
      <section className="chat-screen" role="dialog" aria-modal="true" aria-label="Unlock chat">
        <header className="chat-topbar">
          <span className="chat-brand">Ask Keeper</span>
          <button className="chat-x" aria-label="Close chat" onClick={onClose}><CloseIcon size={20} /></button>
        </header>
        <div className="chat-lock">
          <form
            className="chat-lock-card"
            onSubmit={(e) => { e.preventDefault(); void unlock(new FormData(e.currentTarget).get("cpw") as string); }}
          >
            <p className="chat-lock-title">The chat is password-protected.</p>
            <p className="chat-lock-sub">The rest of Keeper is open — chat needs a password because it uses a paid AI service.</p>
            <input
              className="gate-input"
              type="password"
              name="cpw"
              autoFocus
              autoComplete="current-password"
              aria-label="Chat password"
              placeholder="Password"
            />
            {pwWrong && <p className="gate-error" role="alert">That’s not it — try again.</p>}
            <button className="gate-submit" type="submit">Unlock chat</button>
          </form>
        </div>
      </section>
    );
  }

  const inConversation = active != null;

  return (
    <section className="chat-screen" role="dialog" aria-modal="true" aria-label="Keeper chat">
      <header className="chat-topbar">
        {inConversation ? (
          <button className="chat-back" onClick={() => { setActive(null); setSessions(null); }}>← Chats</button>
        ) : (
          <span className="chat-brand">Ask Keeper</span>
        )}
        {inConversation && <button className="chat-newbtn" onClick={startNew}>+ New</button>}
        <button className="chat-x" aria-label="Close chat" onClick={onClose}><CloseIcon size={20} /></button>
      </header>

      {!inConversation && (
        <div className="chat-home">
          <button className="chat-new-primary" onClick={startNew}>Start a new chat</button>
          {error && <div className="chat-error" role="alert">{error}</div>}
          <h3 className="chat-home-h">Recent</h3>
          <ul className="chat-sessions">
            {(sessions ?? []).map((s) => (
              <li key={s.id}>
                <button className="chat-session-row" onClick={() => setActive(s.id)}>
                  <span className="chat-session-title">{s.title}</span>
                  <span className="chat-session-meta">{s.messageCount} message{s.messageCount === 1 ? "" : "s"}</span>
                </button>
              </li>
            ))}
            {sessions?.length === 0 && <li className="chat-muted">No chats yet — start one above.</li>}
            {sessions === null && <li className="chat-muted">Loading…</li>}
          </ul>
        </div>
      )}

      {inConversation && (
        <>
          <div className="chat-body" ref={bodyRef}>
            <div className="chat-col">
              {messages.length === 0 && live === null && (
                <div className="chat-welcome">
                  <p>Ask about seasons, limits, licenses, or stocking. Answers come from Keeper's verified data first, with sources — and fall back to a web search when we don't have the water.</p>
                  <div className="chat-suggests">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} className="chat-suggest" onClick={() => void send(s)}>{s}</button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) => (
                <div key={m.id} className={`chat-turn chat-turn--${m.role}`}>
                  {m.role === "assistant" && (m.cards ?? []).map((c, i) => (
                    <ChatCard key={i} card={c} onOpenWater={onOpenWater} />
                  ))}
                  <div className={`chat-msg chat-msg--${m.role}`}>
                    {m.role === "assistant" ? renderMarkdown(m.content) : m.content}
                  </div>
                </div>
              ))}

              {(live !== null || liveCards.length > 0 || toolNote) && (
                <div className="chat-turn chat-turn--assistant">
                  {liveCards.map((c, i) => <ChatCard key={i} card={c} onOpenWater={onOpenWater} />)}
                  {toolNote && <div className="chat-tool-note">{toolNote}</div>}
                  {live !== null && live !== "" && (
                    <div className="chat-msg chat-msg--assistant">{renderMarkdown(live)}</div>
                  )}
                </div>
              )}

              {error && <div className="chat-error" role="alert">{error}</div>}
            </div>
          </div>

          <form className="chat-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <div className="chat-col chat-compose-col">
              <input
                className="chat-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask about any CA or NV water…"
                maxLength={2000}
                aria-label="Chat message"
                autoFocus
              />
              <button className="chat-send" type="submit" disabled={busy || !draft.trim()}>Send</button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
