import { useState } from "react";
import { toast } from "sonner";
import { Building2, KeyRound, MoreHorizontal, Pause, Play, Plus, UserPlus } from "lucide-react";
import { api } from "../lib/api";
import { cn, timeAgo, useApi } from "../lib/utils";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Skeleton } from "../components/ui";
import { TempPassword } from "./AdminUsers";

interface CompanyAdmin { id: string; name: string; email: string; active: boolean; must_change_password: boolean; last_login_at: string | null }
interface Company {
  id: string; name: string; status: "active" | "suspended"; created_at: string | null;
  user_count: number; project_count: number; roles: Record<"admin" | "estimator" | "architect", number>;
  admins: CompanyAdmin[];
}
interface Created { company: Company; admin_email: string; temporary_password: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "New company" and "Add admin" share this form; the company name is only asked for a new company. */
function CompanyForm({ open, company, onClose, onCreated }: { open: boolean; company: Company | null; onClose: () => void; onCreated: (r: Created) => void }) {
  const [f, setF] = useState({ name: "", admin_name: "", admin_email: "" });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const errs = {
    name: !company && f.name.trim().length < 2 ? "Enter the company name" : null,
    admin_name: !f.admin_name.trim() ? "Enter the admin's name" : null,
    admin_email: !EMAIL.test(f.admin_email.trim()) ? "Enter a valid email" : null,
  };
  const close = () => { setF({ name: "", admin_name: "", admin_email: "" }); setTouched(false); onClose(); };
  const submit = async () => {
    setTouched(true);
    if (Object.values(errs).some(Boolean)) return;
    setSaving(true);
    try {
      const r = company
        ? await api.post<Created>(`/platform/companies/${company.id}/admins`, { name: f.admin_name, email: f.admin_email })
        : await api.post<Created>("/platform/companies", f);
      close();
      onCreated(r);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={open} onClose={close} title={company ? `Add an admin to ${company.name}` : "New company"}
      description={company ? "They can manage this company's users, pricing and offcuts." : "Creates the company workspace and its first admin. The admin then adds their estimators and architects."}
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button loading={saving} onClick={submit}>{company ? "Add admin" : "Create company"}</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {!company && <Field label="Company name" htmlFor="c-name" error={touched ? errs.name : null}>
          <Input id="c-name" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Acme Glazing Pvt Ltd" invalid={touched && !!errs.name} />
        </Field>}
        <Field label="Admin's full name" htmlFor="c-admin" error={touched ? errs.admin_name : null}>
          <Input id="c-admin" autoFocus={!!company} value={f.admin_name} onChange={(e) => setF({ ...f, admin_name: e.target.value })} placeholder="Priya Sharma" invalid={touched && !!errs.admin_name} />
        </Field>
        <Field label="Admin's work email" htmlFor="c-email" error={touched ? errs.admin_email : null}>
          <Input id="c-email" type="email" value={f.admin_email} onChange={(e) => setF({ ...f, admin_email: e.target.value })} placeholder="priya@acmeglazing.in" invalid={touched && !!errs.admin_email} />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

function CompanyMenu({ c, onChanged, onAddAdmin, onTemp, onSuspend }: {
  c: Company; onChanged: () => void; onAddAdmin: () => void; onTemp: (email: string, pw: string) => void; onSuspend: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800";
  const reset = (a: CompanyAdmin) => {
    setOpen(false);
    api.post<{ admin_email: string; temporary_password: string }>(`/platform/admins/${a.id}/reset-password`)
      .then((r) => { onTemp(r.admin_email, r.temporary_password); onChanged(); })
      .catch((e) => toast.error(e.message));
  };
  const resume = () => {
    setOpen(false);
    api.patch(`/platform/companies/${c.id}`, { status: "active" }).then(() => { toast.success(`${c.name} reactivated`); onChanged(); }).catch((e) => toast.error(e.message));
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label={`Actions for ${c.name}`} aria-expanded={open}><MoreHorizontal className="h-4 w-4" /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-64 rounded-2xl bg-white p-1.5 shadow-pop ring-1 ring-black/5 dark:bg-slate-900 dark:ring-white/10">
            <button className={item} onClick={() => { setOpen(false); onAddAdmin(); }}><UserPlus className="h-4 w-4" /> Add an admin</button>
            {c.admins.map((a) => (
              <button key={a.id} className={item} onClick={() => reset(a)}><KeyRound className="h-4 w-4 shrink-0" /> <span className="truncate">Reset password: {a.name}</span></button>
            ))}
            <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
            {c.status === "active"
              ? <button className={cn(item, "text-[#d70015]")} onClick={() => { setOpen(false); onSuspend(); }}><Pause className="h-4 w-4" /> Suspend company</button>
              : <button className={item} onClick={resume}><Play className="h-4 w-4" /> Reactivate company</button>}
          </div>
        </>
      )}
    </div>
  );
}

export default function Platform() {
  const { data, error, loading, reload } = useApi<Company[]>("/platform/companies");
  const [formFor, setFormFor] = useState<Company | null | "new">(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const [suspending, setSuspending] = useState<Company | null>(null);

  const suspend = async (c: Company) => {
    setSuspending(null);
    try {
      await api.patch(`/platform/companies/${c.id}`, { status: "suspended" });
      toast.success(`${c.name} suspended`, { description: "Its users were signed out and can't sign in until you reactivate it." });
      reload(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const active = data?.filter((c) => c.status === "active").length ?? 0;
  const users = data?.reduce((a, c) => a + c.user_count, 0) ?? 0;

  return (
    <div>
      <PageHeader title="Companies" subtitle={data ? `${active} active of ${data.length} · ${users} users across all companies` : "Every company on VitroStack and its admins."}
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormFor("new")}>New company</Button>} />

      <p className="mb-5 max-w-3xl text-sm text-slate-500">You create each company and its first admin. That admin adds their own estimators and architects under Admin → Users. As superadmin you see company names, users and counts only, never their projects, prices or offcuts.</p>

      {error && <ErrorState message={error} onRetry={() => reload()} />}
      <Card className="overflow-hidden">
        {loading && <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
        {data && data.length === 0 && <EmptyState icon={<Building2 className="h-6 w-6" />} title="No companies yet" body="Create the first company and its admin."
          action={<Button onClick={() => setFormFor("new")}>New company</Button>} />}
        {data && data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Company</th><th>Admins</th><th className="text-right">Users</th><th className="text-right">Projects</th><th>Status</th><th>Created</th><th className="w-12" /></tr></thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id} className={cn(c.status === "suspended" && "opacity-60")}>
                    <td>
                      <p className="font-medium text-[#1d1d1f] dark:text-white">{c.name}</p>
                      <p className="text-xs text-slate-500">{c.roles.estimator} estimators · {c.roles.architect} architects</p>
                    </td>
                    <td>
                      {c.admins.length === 0 ? <span className="text-sm text-[#d70015]">No admin</span> : c.admins.map((a) => (
                        <p key={a.id} className="text-sm">{a.name} <span className="text-slate-500">· {a.email}</span>
                          {a.must_change_password && <Badge tone="amber" className="ml-1.5">Invite pending</Badge>}
                          {!a.active && <Badge tone="slate" className="ml-1.5">Deactivated</Badge>}
                        </p>
                      ))}
                    </td>
                    <td className="text-right tabular-nums">{c.user_count}</td>
                    <td className="text-right tabular-nums">{c.project_count}</td>
                    <td>{c.status === "active" ? <Badge tone="emerald" dot>Active</Badge> : <Badge tone="rose">Suspended</Badge>}</td>
                    <td className="whitespace-nowrap text-sm text-slate-500">{c.created_at ? timeAgo(c.created_at) : "—"}</td>
                    <td><CompanyMenu c={c} onChanged={() => reload(true)} onAddAdmin={() => setFormFor(c)} onTemp={(email, password) => setTemp({ email, password })} onSuspend={() => setSuspending(c)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CompanyForm open={formFor !== null} company={formFor === "new" ? null : formFor} onClose={() => setFormFor(null)}
        onCreated={(r) => { setTemp({ email: r.admin_email, password: r.temporary_password }); toast.success(`${r.company.name} is ready`); reload(true); }} />
      {temp && <TempPassword email={temp.email} password={temp.password} onClose={() => setTemp(null)} />}
      <Modal open={!!suspending} onClose={() => setSuspending(null)} title={`Suspend ${suspending?.name ?? ""}?`}
        description="Everyone in this company is signed out and can't sign in until you reactivate it. No data is deleted."
        footer={<><Button variant="secondary" onClick={() => setSuspending(null)}>Cancel</Button><Button variant="danger" onClick={() => suspending && suspend(suspending)}>Suspend company</Button></>}>
        <p className="text-sm text-slate-600 dark:text-slate-400">Use this for unpaid or ended accounts. Reactivating restores access with all their projects intact.</p>
      </Modal>
    </div>
  );
}
