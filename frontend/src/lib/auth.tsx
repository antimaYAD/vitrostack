import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./api";

export type Role = "superadmin" | "admin" | "estimator" | "architect";

export const ROLE_LABEL: Record<Role, string> = { superadmin: "Superadmin", admin: "Admin", estimator: "Estimator", architect: "Architect" };

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  company_name?: string | null;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string | null;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  /** Platform owner: manages companies, has no company workspace. */
  isSuperadmin: boolean;
  /** Admins and estimators can change projects, quote, use the copilot and site ops. Architects are view-only. */
  canEdit: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ user: User }>("/auth/me").then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false));
    // Any API call that comes back 401 (expired / revoked session) signs the user out locally.
    const onUnauthorized = () => setUser(null);
    window.addEventListener("vs:unauthorized", onUnauthorized);
    return () => window.removeEventListener("vs:unauthorized", onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string, remember: boolean) => {
    const r = await api.post<{ user: User }>("/auth/login", { email, password, remember });
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user, loading, login, logout, setUser,
    isAdmin: user?.role === "admin",
    isSuperadmin: user?.role === "superadmin",
    canEdit: user?.role === "admin" || user?.role === "estimator",
  }), [user, loading, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-label="Loading" />
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}

export function RequireSuperadmin({ children }: { children: ReactNode }) {
  const { isSuperadmin } = useAuth();
  if (!isSuperadmin) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}

export function RequireEditor({ children }: { children: ReactNode }) {
  const { canEdit } = useAuth();
  if (!canEdit) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}
