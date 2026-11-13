import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bot, ChevronRight, FolderKanban, KeyRound, LogOut, Moon, Search, ShieldCheck, Sun } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { ChangePasswordModal } from "./AccountModals";
import { api, type ProjectSummary, type Reference } from "../lib/api";
import { cn } from "../lib/utils";
import { Kbd } from "./ui";

// ---------------------------------------------------------------- shared app context

interface AppCtx {
  reference: Reference | null;
  alertCount: number;
  refreshAlerts: () => void;
  health: { agent_engine: string; whatsapp: string } | null;
  openPalette: () => void;
  refreshReference: () => void;
}
const Ctx = createContext<AppCtx>({ reference: null, alertCount: 0, refreshAlerts: () => {}, health: null, openPalette: () => {}, refreshReference: () => {} });
export const useApp = () => useContext(Ctx);

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/copilot", label: "Copilot" },
  { to: "/projects", label: "Projects" },
  { to: "/engineering", label: "Engineering" },
  { to: "/inventory", label: "Offcuts" },
  { to: "/site", label: "Site Ops", badge: true },
  { to: "/admin", label: "Admin", admin: true },
];

function UserMenu({ onPassword }: { onPassword: () => void }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  if (!user) return null;
  const initials = user.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const signOut = async () => {
    setOpen(false);
    await logout();
    toast.success("Signed out");
    nav("/login", { replace: true });
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-expanded={open}
        className={cn("ml-1 flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-transparent transition hover:ring-brand-600/30",
          user.role === "admin" ? "bg-gradient-to-br from-[#0071e3] to-[#5e5ce6]" : "bg-gradient-to-br from-slate-400 to-slate-600")}>
        {initials}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-2xl bg-white/90 p-1.5 shadow-pop ring-1 ring-black/5 backdrop-blur-2xl animate-fade-in dark:bg-[#1c1c1e]/90 dark:ring-white/10">
            <div className="px-3 py-2.5">
              <p className="truncate text-[15px] font-semibold text-[#1d1d1f] dark:text-white">{user.name}</p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
              <span className={cn("mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                user.role === "admin" ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
                {user.role === "admin" && <ShieldCheck className="h-3 w-3" />}{user.role === "admin" ? "Admin" : "Estimator"}
              </span>
            </div>
            <div className="my-1 h-px bg-black/5 dark:bg-white/10" />
            <button onClick={() => { setOpen(false); onPassword(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-[#1d1d1f] hover:bg-black/5 dark:text-slate-200 dark:hover:bg-white/10"><KeyRound className="h-4 w-4 text-slate-400" /> Change password</button>
            <button onClick={signOut} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-[#1d1d1f] hover:bg-black/5 dark:text-slate-200 dark:hover:bg-white/10"><LogOut className="h-4 w-4 text-slate-400" /> Sign out</button>
          </div>
        </>
      )}
    </div>
  );
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = useCallback(() => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      try { localStorage.setItem("vs-theme", next ? "dark" : "light"); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);
  return { dark, toggle };
}

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 text-[#1d1d1f] dark:text-white" aria-label="VitroStack home">
      <svg viewBox="0 0 32 32" className="h-[22px] w-[22px]" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-current" />
        <path d="M9 8h6v16H9zM17 8h6v7h-6zM17 17h6v7h-6z" className="fill-white dark:fill-black" />
      </svg>
      <span className="text-[15px] font-semibold tracking-display">VitroStack</span>
    </Link>
  );
}

// ---------------------------------------------------------------- command palette (Spotlight-style)

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [active, setActive] = useState(0);
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    api.get<ProjectSummary[]>("/projects").then(setProjects).catch(() => {});
    setTimeout(() => input.current?.focus(), 20);
  }, [open]);

  const items = useMemo(() => {
    const ql = q.toLowerCase().trim();
    const out: { id: string; label: string; hint: string; icon: ReactNode; run: () => void }[] = [];
    if (ql) out.push({ id: "ask", label: `Ask VitroCore: “${q}”`, hint: "Copilot", icon: <Bot className="h-4 w-4" />, run: () => nav(`/copilot?q=${encodeURIComponent(q)}`) });
    NAV.filter((n) => (!("admin" in n) || isAdmin) && (!ql || n.label.toLowerCase().includes(ql))).forEach((n) =>
      out.push({ id: n.to, label: n.label, hint: "Go to", icon: <ChevronRight className="h-4 w-4" />, run: () => nav(n.to) }));
    projects.filter((p) => !ql || `${p.name} ${p.client ?? ""} ${p.city}`.toLowerCase().includes(ql)).slice(0, 6).forEach((p) =>
      out.push({ id: p.id, label: p.name, hint: `${p.city} · ${p.status}`, icon: <FolderKanban className="h-4 w-4" />, run: () => nav(`/projects/${p.id}`) }));
    return out;
  }, [q, projects, nav, isAdmin]);

  useEffect(() => setActive(0), [q]);
  if (!open) return null;

  const run = (i: number) => {
    items[i]?.run();
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[14vh]" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[620px] overflow-hidden rounded-[22px] bg-white/85 shadow-pop ring-1 ring-black/5 backdrop-blur-2xl backdrop-saturate-150 animate-fade-in dark:bg-[#1c1c1e]/85 dark:ring-white/10">
        <div className="flex items-center gap-3 px-5">
          <Search className="h-5 w-5 text-slate-400" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter") run(active);
              if (e.key === "Escape") onClose();
            }}
            placeholder="Search projects or ask VitroCore"
            className="h-16 flex-1 bg-transparent text-xl text-[#1d1d1f] outline-none placeholder:text-slate-400 dark:text-white"
          />
          <Kbd>esc</Kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto border-t border-black/5 p-2 dark:border-white/10">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No results</li>}
          {items.map((it, i) => (
            <li key={it.id}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => run(i)}
                className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px]", i === active ? "bg-brand-600 text-white" : "text-[#1d1d1f] dark:text-slate-200")}
              >
                <span className={i === active ? "text-white/80" : "text-slate-400"}>{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                <span className={cn("text-xs", i === active ? "text-white/70" : "text-slate-400")}>{it.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- layout

export default function Layout() {
  const [reference, setReference] = useState<Reference | null>(null);
  const [health, setHealth] = useState<AppCtx["health"]>(null);
  const [alertCount, setAlertCount] = useState(0);
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const { dark, toggle } = useTheme();
  const { user, isAdmin, logout } = useAuth();
  const navItems = NAV.filter((n) => !("admin" in n) || isAdmin);
  const loc = useLocation();

  const refreshAlerts = useCallback(() => {
    api.get<{ open: number }>("/alerts/count").then((r) => setAlertCount(r.open)).catch(() => {});
  }, []);

  const refreshReference = useCallback(() => { api.get<Reference>("/reference").then(setReference).catch(() => {}); }, []);
  useEffect(() => {
    refreshReference();
    api.get<AppCtx["health"]>("/health").then(setHealth).catch(() => setHealth(null));
    refreshAlerts();
    const t = setInterval(refreshAlerts, 15000);
    return () => clearInterval(t);
  }, [refreshAlerts, refreshReference]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => { document.body.style.overflow = menu ? "hidden" : ""; }, [menu]);

  const ctx = useMemo(() => ({ reference, alertCount, refreshAlerts, health, openPalette: () => setPalette(true), refreshReference }), [reference, alertCount, refreshAlerts, health, refreshReference]);
  const fullBleed = loc.pathname.startsWith("/copilot");
  const iconBtn = "flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition hover:bg-black/5 hover:text-[#1d1d1f] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white";

  return (
    <Ctx.Provider value={ctx}>
      <div className="min-h-screen">
        <header className={cn("glass-nav sticky top-0 z-40 border-b border-black/[0.06] dark:border-white/[0.08]", menu && "!bg-white dark:!bg-black")}>
          <div className="mx-auto flex h-12 max-w-[1120px] items-center gap-6 px-5">
            <Logo />
            <nav className="hidden flex-1 items-center justify-center gap-1 md:flex" aria-label="Main">
              {navItems.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end}
                  className={({ isActive }) => cn("relative rounded-full px-3 py-1.5 text-[13px] transition-colors",
                    isActive ? "text-[#1d1d1f] dark:text-white" : "text-slate-500 hover:text-[#1d1d1f] dark:text-slate-400 dark:hover:text-white")}>
                  {({ isActive }) => (
                    <>
                      {n.label}
                      {n.badge && alertCount > 0 && <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[10px] font-semibold text-white">{alertCount}</span>}
                      {isActive && <span className="absolute inset-x-3 -bottom-[7px] h-[2px] rounded-full bg-[#1d1d1f] dark:bg-white" />}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-0.5 md:ml-0">
              <button onClick={() => setPalette(true)} className={iconBtn} aria-label="Search (Ctrl K)" title="Search  Ctrl K"><Search className="h-[17px] w-[17px]" /></button>
              <button onClick={toggle} className={iconBtn} aria-label={dark ? "Light mode" : "Dark mode"} title="Toggle appearance">{dark ? <Sun className="h-[17px] w-[17px]" /> : <Moon className="h-[17px] w-[17px]" />}</button>
              <span className={cn("ml-1 hidden h-2 w-2 rounded-full sm:block", health ? "bg-[#34c759]" : "bg-[#ff3b30]")}
                title={health ? `Engines online · Agent: ${health.agent_engine.startsWith("gemini") ? health.agent_engine : "offline planner"} · WhatsApp: ${health.whatsapp}` : "Backend offline"} />
              <UserMenu onPassword={() => setPwOpen(true)} />
              <button onClick={() => setMenu((m) => !m)} className={cn(iconBtn, "md:hidden")} aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu}>
                <span className="relative block h-3 w-[18px]">
                  <span className={cn("absolute left-0 h-[1.5px] w-full rounded bg-current transition-all duration-300", menu ? "top-1.5 rotate-45" : "top-0.5")} />
                  <span className={cn("absolute left-0 h-[1.5px] w-full rounded bg-current transition-all duration-300", menu ? "top-1.5 -rotate-45" : "top-[9px]")} />
                </span>
              </button>
            </div>
          </div>
        </header>

        {/* Mobile full-screen menu */}
        {menu && (
          <div className="fixed inset-x-0 bottom-0 top-12 z-30 overflow-y-auto bg-white px-10 pt-6 animate-fade-in md:hidden dark:bg-black">
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              {navItems.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn("flex items-center gap-3 py-2 text-[28px] font-semibold tracking-display", isActive ? "text-[#1d1d1f] dark:text-white" : "text-slate-500 dark:text-slate-400")}>
                  {n.label}
                  {n.badge && alertCount > 0 && <span className="rounded-full bg-[#ff3b30] px-2 py-0.5 text-xs font-semibold text-white">{alertCount}</span>}
                </NavLink>
              ))}
            </nav>
            {user && (
              <div className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-800">
                <p className="text-[15px] font-semibold">{user.name} <span className="text-xs font-normal text-slate-500">· {user.role === "admin" ? "Admin" : "Estimator"}</span></p>
                <p className="text-sm text-slate-500">{user.email}</p>
                <div className="mt-4 flex gap-3">
                  <button onClick={() => { setMenu(false); setPwOpen(true); }} className="link text-[15px]">Change password</button>
                  <button onClick={async () => { await logout(); }} className="link text-[15px]">Sign out</button>
                </div>
              </div>
            )}
            <p className="mt-10 text-xs text-slate-500">{health ? `Engines online · ${health.agent_engine.startsWith("gemini") ? "Gemini" : "Offline planner"} · WhatsApp ${health.whatsapp}` : "Backend offline"}</p>
          </div>
        )}

        <main>
          {fullBleed ? <Outlet /> : (
            <div className="mx-auto max-w-[1120px] px-5 pb-20 pt-10 sm:pt-14"><Outlet /></div>
          )}
        </main>
        <CommandPalette open={palette} onClose={() => setPalette(false)} />
        <ChangePasswordModal open={pwOpen || !!user?.must_change_password} forced={!!user?.must_change_password} onClose={() => setPwOpen(false)} />
      </div>
    </Ctx.Provider>
  );
}
