import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Plus, Settings2, ShieldCheck, UserRound, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAuth, type Role as AnyRole, type User } from "../lib/auth";
import { cn, timeAgo, useApi } from "../lib/utils";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Segmented, Skeleton } from "../components/ui";
import { AdminTabs } from "../components/AccountModals";
import { ManageUserModal } from "../components/ManageUserModal";

/** Roles a company admin can give. The superadmin role exists only on the platform. */
type Role = Exclude<AnyRole, "superadmin">;
const ROLE_INFO: Record<Role, { label: string; desc: string }> = {
  admin: { label: "Admin", desc: "Everything, plus pricing, users, offcuts and deleting projects." },
  estimator: { label: "Estimator", desc: "Projects, copilot, quotes and site ops. Views offcuts. No admin area." },
  architect: { label: "Architect", desc: "Designer and engineering tools. Views projects without prices or quotes." },
};
const ROLES = Object.keys(ROLE_INFO) as Role[];

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

export function TempPassword({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Email: ${email}\nTemporary password: ${password}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy – select the password and copy it manually");
    }
  };
  return (
    <Modal open onClose={onClose} title="Share these sign-in details" description="This password is shown only once. The user must choose a new one when they first sign in."
      footer={<Button onClick={onClose}>Done</Button>}>
      <div className="rounded-2xl bg-slate-50 p-5 dark:bg-slate-800/60">
        <p className="text-xs text-slate-500">Email</p>
        <p className="text-[17px] font-medium">{email}</p>
        <p className="mt-3 text-xs text-slate-500">Temporary password</p>
        <div className="flex items-center gap-3">
          <code className="select-all font-mono text-[19px] font-semibold tracking-wide">{password}</code>
          <Button variant="secondary" size="sm" onClick={copy} icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}>{copied ? "Copied" : "Copy"}</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const { data, error, loading, reload } = useApi<User[]>("/admin/users");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", role: "estimator" as Role });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  // Keep the id, not the object, so the dialog shows fresh data after each save.
  const [managingId, setManagingId] = useState<string | null>(null);
  const managing = data?.find((u) => u.id === managingId) ?? null;

  const errs = { name: !f.name.trim() ? "Name is required" : null, email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) ? "Enter a valid email" : null };
  const create = async () => {
    setTouched(true);
    if (errs.name || errs.email) return;
    setSaving(true);
    try {
      const r = await api.post<{ user: User; temporary_password: string }>("/admin/users", f);
      setOpen(false);
      setF({ name: "", email: "", role: "estimator" });
      setTouched(false);
      setTemp({ email: r.user.email, password: r.temporary_password });
      reload(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const admins = data?.filter((u) => u.role === "admin" && u.active).length ?? 0;

  return (
    <div>
      <PageHeader eyebrow={<AdminTabs />} title="Users" subtitle="Who can sign in, and what they can do. Click a person to edit, change their password or remove them."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Add user</Button>} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {ROLES.map((r) => (
          <Card key={r} className="flex gap-4 p-5">
            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", r === "admin" ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
              {r === "admin" ? <ShieldCheck className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
            </div>
            <div>
              <p className="font-semibold">{ROLE_INFO[r].label} <span className="font-normal text-slate-500">· {data?.filter((u) => u.role === r).length ?? "–"}</span></p>
              <p className="text-sm text-slate-500">{ROLE_INFO[r].desc}</p>
            </div>
          </Card>
        ))}
      </div>

      {error && <ErrorState message={error} onRetry={() => reload()} />}
      <Card className="overflow-hidden">
        {loading && <div className="space-y-2 p-5">{[0, 1].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
        {data && data.length === 0 && <EmptyState icon={<Users className="h-6 w-6" />} title="No users" />}
        {data && data.length > 0 && me && (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th className="w-28" /></tr></thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id} onClick={() => setManagingId(u.id)} className={cn("cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/40", !u.active && "opacity-60")}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white", u.role === "admin" ? "bg-gradient-to-br from-[#0071e3] to-[#5e5ce6]" : "bg-gradient-to-br from-slate-400 to-slate-600")}>{initials(u.name)}</div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[#1d1d1f] dark:text-white">{u.name}{u.id === me.id && <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span>}</p>
                          <p className="truncate text-xs text-slate-500">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td><Badge tone={u.role === "admin" ? "brand" : "slate"}>{ROLE_INFO[u.role as Role]?.label ?? u.role}</Badge></td>
                    <td>{!u.active ? <Badge tone="slate">Deactivated</Badge> : u.must_change_password ? <Badge tone="amber">Invite pending</Badge> : <Badge tone="emerald" dot>Active</Badge>}</td>
                    <td className="whitespace-nowrap text-sm text-slate-500">{u.last_login_at ? timeAgo(u.last_login_at) : "Never"}</td>
                    <td className="text-right"><Button variant="secondary" size="sm" icon={<Settings2 className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); setManagingId(u.id); }}>Manage</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {admins === 1 && <p className="mt-3 text-xs text-slate-500">Tip: add a second admin so you're never locked out. The last active admin can't be demoted or deactivated.</p>}

      <Modal open={open} onClose={() => setOpen(false)} title="Add user" description="We'll generate a temporary password for you to share."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={saving} onClick={create}>Add user</Button></>}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <Field label="Full name" htmlFor="u-name" error={touched ? errs.name : null}><Input id="u-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Priya Sharma" invalid={touched && !!errs.name} /></Field>
          <Field label="Work email" htmlFor="u-email" error={touched ? errs.email : null}><Input id="u-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="priya@company.com" invalid={touched && !!errs.email} /></Field>
          <Field label="Role" htmlFor="u-role" hint={ROLE_INFO[f.role].desc}>
            <Segmented value={f.role} onChange={(v) => setF({ ...f, role: v })} options={[{ value: "estimator", label: "Estimator" }, { value: "architect", label: "Architect" }, { value: "admin", label: "Admin" }]} />
          </Field>
          <button type="submit" className="hidden" />
        </form>
      </Modal>
      {temp && <TempPassword email={temp.email} password={temp.password} onClose={() => setTemp(null)} />}
      {managing && me && (
        <ManageUserModal key={managing.id} person={managing} basePath={`/admin/users/${managing.id}`} self={managing.id === me.id}
          subtitle={ROLE_INFO[managing.role as Role]?.label}
          roleOptions={ROLES.map((r) => ({ value: r, label: ROLE_INFO[r].label, desc: ROLE_INFO[r].desc }))}
          onClose={() => setManagingId(null)} onChanged={() => reload(true)} onTemp={(email, password) => setTemp({ email, password })} />
      )}
    </div>
  );
}
