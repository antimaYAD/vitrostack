import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth, type User } from "../lib/auth";
import { cn } from "../lib/utils";
import { passwordProblem } from "../components/AccountModals";

export default function Register() {
  const { user, loading, setUser } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ company: "", name: "", email: "", password: "" });
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => { api.get<{ allow_signup: boolean }>("/auth/options").then((r) => setAllowed(r.allow_signup)).catch(() => setAllowed(true)); }, []);

  if (!loading && user) return <Navigate to="/" replace />;

  const errs = {
    company: f.company.trim().length < 2 ? "Enter your company name" : null,
    name: !f.name.trim() ? "Enter your name" : null,
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) ? "Enter a valid email" : null,
    password: passwordProblem(f.password),
  };
  const invalid = Object.values(errs).some(Boolean);
  const pwChecks = [
    { ok: f.password.length >= 8, label: "8+ characters" },
    { ok: /[a-zA-Z]/.test(f.password) && /\d/.test(f.password), label: "Letters and numbers" },
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: User; company: string }>("/auth/register", { ...f, remember: true });
      setUser(r.user);
      toast.success(`Welcome to VitroStack, ${r.user.name.split(" ")[0]}`, { description: `${r.company} workspace created. You're its admin. Invite your team from Admin → Users.` });
      nav("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = (bad: boolean) => cn("block h-12 w-full rounded-xl border bg-white px-4 text-[17px] text-[#1d1d1f] transition placeholder:text-slate-400 focus:outline-none focus:ring-4 dark:bg-slate-900 dark:text-white",
    bad ? "border-[#d70015] focus:ring-[#d70015]/15" : "border-slate-300 focus:border-brand-600 focus:ring-brand-600/15 dark:border-slate-700");
  const field = (key: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div>
      <label htmlFor={`r-${key}`} className="mb-1.5 block text-[13px] font-medium text-slate-600 dark:text-slate-300">{label}</label>
      <input id={`r-${key}`} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} className={input(touched && !!errs[key])} {...props} />
      {touched && errs[key] && key !== "password" && <p className="mt-1 text-xs text-[#d70015]">{errs[key]}</p>}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-5 py-12 dark:bg-black">
      <div className="w-full max-w-[420px] animate-fade-in">
        <div className="mb-8 text-center">
          <svg viewBox="0 0 32 32" className="mx-auto h-12 w-12 text-[#1d1d1f] dark:text-white" aria-hidden>
            <rect width="32" height="32" rx="8" className="fill-current" />
            <path d="M9 8h6v16H9zM17 8h6v7h-6zM17 17h6v7h-6z" className="fill-white dark:fill-black" />
          </svg>
          <h1 className="mt-6 text-[32px] font-semibold tracking-tightest text-[#1d1d1f] dark:text-white">Create your account</h1>
          <p className="mt-2 text-[17px] text-slate-500">Set up a workspace for your company. You'll be its admin.</p>
        </div>

        {allowed === false ? (
          <div className="rounded-2xl bg-slate-50 p-6 text-center text-[15px] text-slate-600 dark:bg-slate-900 dark:text-slate-400">
            Sign-up is turned off for this installation. Ask your VitroStack admin to add you.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            {field("company", "Company", { placeholder: "Acme Glazing Pvt Ltd", autoComplete: "organization", autoFocus: true })}
            {field("name", "Your name", { placeholder: "Priya Sharma", autoComplete: "name" })}
            {field("email", "Work email", { type: "email", placeholder: "priya@acmeglazing.in", autoComplete: "email" })}
            <div>
              <label htmlFor="r-password" className="mb-1.5 block text-[13px] font-medium text-slate-600 dark:text-slate-300">Password</label>
              <div className="relative">
                <input id="r-password" type={show ? "text" : "password"} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" className={cn(input(touched && !!errs.password), "pr-12")} />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:text-slate-700" aria-label={show ? "Hide password" : "Show password"}>
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="mt-2 flex gap-4">
                {pwChecks.map((c) => (
                  <span key={c.label} className={cn("inline-flex items-center gap-1 text-xs", c.ok ? "text-[#1a8f3a] dark:text-[#4ade80]" : touched ? "text-[#d70015]" : "text-slate-400")}>
                    <Check className={cn("h-3.5 w-3.5", !c.ok && "opacity-40")} /> {c.label}
                  </span>
                ))}
              </div>
            </div>
            {error && <p role="alert" className="text-sm text-[#d70015] dark:text-[#ff6961]">{error}{error.includes("Sign in") && <> <Link to="/login" className="link">Go to sign in</Link></>}</p>}
            <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-600 text-[17px] text-white transition hover:bg-brand-500 disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create account
            </button>
            <p className="text-center text-xs text-slate-500">Joining an existing company? Ask its admin to add you instead.</p>
          </form>
        )}

        <p className="mt-8 text-center text-[15px] text-slate-600 dark:text-slate-400">Already have an account? <Link to="/login" className="link">Sign in</Link></p>
      </div>
    </div>
  );
}
