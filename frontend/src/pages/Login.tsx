import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cn } from "../lib/utils";

interface Demo { email: string; password: string; role: string }

export default function Login() {
  const { user, login, loading } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<Demo[]>([]);
  const [allowSignup, setAllowSignup] = useState(false);
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  useEffect(() => { api.get<{ demo_accounts: Demo[]; allow_signup: boolean }>("/auth/options").then((r) => { setDemo(Array.isArray(r?.demo_accounts) ? r.demo_accounts : []); setAllowSignup(!!r?.allow_signup); }).catch(() => {}); }, []);

  if (!loading && user) return <Navigate to={safeNext} replace />;

  const submit = async (e?: React.FormEvent, creds?: Demo) => {
    e?.preventDefault();
    const em = creds?.email ?? email, pw = creds?.password ?? password;
    if (!em.trim() || !pw) return setError("Enter your email and password");
    setBusy(true);
    setError(null);
    try {
      await login(em, pw, remember);
      nav(safeNext, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  const input = "peer block h-14 w-full rounded-xl border border-slate-300 bg-white px-4 pt-4 text-[17px] text-[#1d1d1f] transition placeholder:text-transparent focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/15 dark:border-slate-700 dark:bg-slate-900 dark:text-white";
  const floating = "pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[17px] text-slate-500 transition-all peer-focus:top-4 peer-focus:text-xs peer-[:not(:placeholder-shown)]:top-4 peer-[:not(:placeholder-shown)]:text-xs";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-5 py-12 dark:bg-black">
      <div className="w-full max-w-[400px] animate-fade-in">
        <div className="mb-10 text-center">
          <svg viewBox="0 0 32 32" className="mx-auto h-12 w-12 text-[#1d1d1f] dark:text-white" aria-hidden>
            <rect width="32" height="32" rx="8" className="fill-current" />
            <path d="M9 8h6v16H9zM17 8h6v7h-6zM17 17h6v7h-6z" className="fill-white dark:fill-black" />
          </svg>
          <h1 className="mt-6 text-[32px] font-semibold tracking-tightest text-[#1d1d1f] dark:text-white">Sign in to VitroStack</h1>
          <p className="mt-2 text-[17px] text-slate-500">Facade engineering, estimating & site ops.</p>
        </div>

        <form onSubmit={submit} className="space-y-3" noValidate>
          <div className="relative">
            <input id="email" type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={cn(input, error && "border-[#d70015]")} autoFocus />
            <label htmlFor="email" className={floating}>Email</label>
          </div>
          <div className="relative">
            <input id="password" type={show ? "text" : "password"} autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className={cn(input, "pr-14", error && "border-[#d70015]")} />
            <label htmlFor="password" className={floating}>Password</label>
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-12 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:text-slate-700" aria-label={show ? "Hide password" : "Show password"}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            <button type="submit" disabled={busy} className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition hover:border-brand-600 hover:text-brand-600 disabled:opacity-50 dark:border-slate-600" aria-label="Sign in">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
          {error && <p role="alert" className="px-1 text-sm text-[#d70015] dark:text-[#ff6961]">{error}</p>}
          <label className="flex cursor-pointer items-center justify-center gap-2 pt-3 text-sm text-slate-600 dark:text-slate-400">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded accent-brand-600" />
            Keep me signed in for 30 days
          </label>
        </form>

        <p className="mt-8 text-center text-sm text-slate-500">Forgot your password? Ask your VitroStack admin to reset it.</p>
        {allowSignup && (
          <p className="mt-3 text-center text-[15px] text-slate-600 dark:text-slate-400">New to VitroStack? <Link to="/register" className="link">Create an account</Link></p>
        )}

        {demo.length > 0 && (
          <div className="mt-10 rounded-2xl bg-slate-50 p-5 dark:bg-slate-900">
            <p className="text-center text-xs font-medium uppercase tracking-wide text-slate-500">Demo accounts</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {demo.map((d) => (
                <button key={d.email} onClick={() => submit(undefined, d)} disabled={busy}
                  className="rounded-xl bg-white px-3 py-3 text-left ring-1 ring-black/5 transition hover:ring-brand-600/50 dark:bg-slate-800 dark:ring-white/10">
                  <p className="text-sm font-medium capitalize text-[#1d1d1f] dark:text-white">{d.role}</p>
                  <p className="truncate text-xs text-slate-500">{d.email}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
