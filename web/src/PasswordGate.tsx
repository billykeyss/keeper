import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { apiHeaders, storePassword, clearPassword } from "./api";

type GateState = "checking" | "locked" | "open";

/** Full-screen password gate for the whole app. Probes /api/auth/check with any stored
 *  password; renders children only on 204. The server enforces the real gate — this is UX.
 *  A 401 anywhere later (api.ts dispatches "keeper:unauthorized") re-locks. */
export function PasswordGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [wrong, setWrong] = useState(false);

  const probe = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/check", { headers: apiHeaders() });
      if (res.status === 204) { setState("open"); return true; }
    } catch { /* network error — treat as locked so the form shows */ }
    setState("locked");
    return false;
  }, []);

  useEffect(() => { void probe(); }, [probe]);

  useEffect(() => {
    const relock = () => { setState("locked"); setWrong(false); };
    window.addEventListener("keeper:unauthorized", relock);
    return () => window.removeEventListener("keeper:unauthorized", relock);
  }, []);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const pw = new FormData(e.currentTarget).get("password");
    if (typeof pw !== "string" || !pw) return;
    storePassword(pw);
    setWrong(false);
    const ok = await probe();
    if (!ok) { clearPassword(); setWrong(true); }
  };

  if (state === "open") return <>{children}</>;
  if (state === "checking") return <div className="gate" aria-hidden="true" />;

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={onSubmit}>
        <span className="brand-wordmark gate-wordmark">
          Keeper
          <span className="brand-seal" aria-hidden="true" />
        </span>
        <p className="gate-sub">Enter the password to open the ledger.</p>
        <input
          className="gate-input"
          type="password"
          name="password"
          autoFocus
          autoComplete="current-password"
          aria-label="Password"
          placeholder="Password"
        />
        {wrong && <p className="gate-error" role="alert">That’s not it — try again.</p>}
        <button className="gate-submit" type="submit">Unlock</button>
      </form>
    </div>
  );
}
