import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Eye, EyeOff, KeyRound, Trash2, UserCheck, UserX } from "lucide-react";
import { api } from "../lib/api";
import { cn, timeAgo } from "../lib/utils";
import { Badge, Button, Field, Input, Modal, Segmented } from "./ui";

export interface ManagedPerson {
  id: string;
  name: string;
  email: string;
  role?: string;
  active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
}

export interface RoleOption { value: string; label: string; desc: string }

type Tab = "details" | "password" | "access";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One place to manage a person: edit details, set or reset the password, deactivate and delete.
 * Used by company admins (Admin → Users) and by the superadmin for company admins (Companies).
 */
export function ManageUserModal({ person, basePath, subtitle, roleOptions, self = false, canDeactivate = true, deleteNote, onClose, onChanged, onTemp }: {
  person: ManagedPerson;
  /** e.g. /admin/users/{id} or /platform/admins/{id}: PATCH to edit, POST /password, POST /reset-password, DELETE. */
  basePath: string;
  subtitle?: string;
  roleOptions?: RoleOption[];
  self?: boolean;
  canDeactivate?: boolean;
  deleteNote?: string;
  onClose: () => void;
  onChanged: () => void;
  onTemp: (email: string, password: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("details");
  const [busy, setBusy] = useState<string | null>(null);

  // details
  const [d, setD] = useState({ name: person.name, email: person.email, role: person.role ?? "" });
  const [dTouched, setDTouched] = useState(false);
  const dErr = { name: !d.name.trim() ? "Name is required" : null, email: !EMAIL.test(d.email.trim()) ? "Enter a valid email" : null };
  const dChanged = d.name.trim() !== person.name || d.email.trim().toLowerCase() !== person.email || (!!roleOptions && d.role !== person.role);

  // password
  const [pw, setPw] = useState({ next: "", confirm: "", mustChange: true });
  const [show, setShow] = useState(false);
  const [pTouched, setPTouched] = useState(false);
  const pErr = {
    next: pw.next.length < 8 ? "At least 8 characters" : /^\d+$/.test(pw.next) || /^[a-zA-Z]+$/.test(pw.next) ? "Use letters and numbers" : null,
    confirm: pw.confirm !== pw.next ? "Passwords don't match" : null,
  };

  // delete
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      onChanged();
      after?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveDetails = () => {
    setDTouched(true);
    if (dErr.name || dErr.email || !dChanged) return;
    const body: Record<string, string> = {};
    if (d.name.trim() !== person.name) body.name = d.name.trim();
    if (d.email.trim().toLowerCase() !== person.email) body.email = d.email.trim();
    if (roleOptions && d.role !== person.role) body.role = d.role;
    run("details", () => api.patch(basePath, body), body.email ? `Saved. ${d.name.trim()} now signs in with ${body.email.toLowerCase()}` : "Details saved");
  };

  const setPassword = () => {
    setPTouched(true);
    if (pErr.next || pErr.confirm) return;
    run("password", () => api.post(`${basePath}/password`, { password: pw.next, must_change: pw.mustChange }),
      `Password changed for ${person.name}`, () => { setPw({ next: "", confirm: "", mustChange: true }); setPTouched(false); });
  };

  const generate = async () => {
    setBusy("generate");
    try {
      const r = await api.post<{ temporary_password: string; admin_email?: string }>(`${basePath}/reset-password`);
      onChanged();
      onClose();
      onTemp(r.admin_email ?? person.email, r.temporary_password);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const status = !person.active ? <Badge tone="slate">Deactivated</Badge>
    : person.must_change_password ? <Badge tone="amber">Must set a new password</Badge> : <Badge tone="emerald" dot>Active</Badge>;

  const section = "rounded-2xl border border-slate-200 p-4 dark:border-slate-800";

  return (
    <Modal open onClose={onClose} size="lg" title={person.name}
      description={<span className="flex flex-wrap items-center gap-2">{person.email}{subtitle && <> · {subtitle}</>} {status}
        <span className="text-xs">· last sign-in {person.last_login_at ? timeAgo(person.last_login_at) : "never"}</span></span>}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="mb-5">
        <Segmented value={tab} onChange={(t) => { setTab(t); setConfirmDelete(false); }} options={[
          { value: "details", label: "Details" }, { value: "password", label: "Password" }, { value: "access", label: "Access & delete" },
        ]} />
      </div>

      {tab === "details" && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); saveDetails(); }}>
          <Field label="Full name" htmlFor="mu-name" error={dTouched ? dErr.name : null}>
            <Input id="mu-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} invalid={dTouched && !!dErr.name} />
          </Field>
          <Field label="Work email" htmlFor="mu-email" error={dTouched ? dErr.email : null} hint="They sign in with this email.">
            <Input id="mu-email" type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} invalid={dTouched && !!dErr.email} />
          </Field>
          {roleOptions && (
            <Field label="Role" hint={self ? "You can't change your own role." : roleOptions.find((r) => r.value === d.role)?.desc}>
              {self ? <p className="text-sm font-medium">{roleOptions.find((r) => r.value === d.role)?.label}</p>
                : <Segmented value={d.role} onChange={(v) => setD({ ...d, role: v })} options={roleOptions.map((r) => ({ value: r.value, label: r.label }))} />}
            </Field>
          )}
          <div className="flex justify-end gap-2 pt-1">
            {dChanged && <Button type="button" variant="ghost" onClick={() => setD({ name: person.name, email: person.email, role: person.role ?? "" })}>Undo changes</Button>}
            <Button type="submit" disabled={!dChanged} loading={busy === "details"}>Save details</Button>
          </div>
        </form>
      )}

      {tab === "password" && (self ? (
        <p className={cn(section, "text-sm text-slate-600 dark:text-slate-400")}>To change your own password, use <b>Change password</b> in your account menu (top right).</p>
      ) : (
        <div className="space-y-5">
          <form className={cn(section, "space-y-4")} onSubmit={(e) => { e.preventDefault(); setPassword(); }}>
            <div>
              <p className="font-semibold">Set a new password</p>
              <p className="text-sm text-slate-500">Choose the password yourself, then share it with {person.name.split(" ")[0]}. They're signed out everywhere.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New password" htmlFor="mu-pw" error={pTouched ? pErr.next : null}>
                <div className="relative">
                  <Input id="mu-pw" type={show ? "text" : "password"} autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} invalid={pTouched && !!pErr.next} className="pr-10" />
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:text-slate-700" aria-label={show ? "Hide password" : "Show password"}>
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <Field label="Confirm password" htmlFor="mu-pw2" error={pTouched ? pErr.confirm : null}>
                <Input id="mu-pw2" type={show ? "text" : "password"} autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} invalid={pTouched && !!pErr.confirm} />
              </Field>
            </div>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={pw.mustChange} onChange={(e) => setPw({ ...pw, mustChange: e.target.checked })} />
              <span>Ask them to choose their own password the next time they sign in <span className="text-slate-500">(recommended)</span></span>
            </label>
            <div className="flex justify-end"><Button type="submit" loading={busy === "password"} icon={<KeyRound className="h-4 w-4" />}>Set password</Button></div>
          </form>
          <div className={cn(section, "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between")}>
            <div>
              <p className="font-semibold">Or generate a temporary password</p>
              <p className="text-sm text-slate-500">We create a random one for you to share. They must change it at sign-in.</p>
            </div>
            <Button variant="secondary" loading={busy === "generate"} onClick={generate}>Generate</Button>
          </div>
        </div>
      ))}

      {tab === "access" && (self ? (
        <p className={cn(section, "text-sm text-slate-600 dark:text-slate-400")}>You can't deactivate or delete your own account. Ask another admin.</p>
      ) : (
        <div className="space-y-5">
          {canDeactivate && (
            <div className={cn(section, "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between")}>
              <div>
                <p className="font-semibold">{person.active ? "Deactivate account" : "Reactivate account"}</p>
                <p className="text-sm text-slate-500">{person.active ? "Signs them out and blocks sign-in. Their history stays. You can undo this." : "Lets them sign in again with their current password."}</p>
              </div>
              <Button variant="secondary" loading={busy === "active"} icon={person.active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                onClick={() => run("active", () => api.patch(basePath, { active: !person.active }), person.active ? `${person.name} deactivated and signed out` : `${person.name} reactivated`)}>
                {person.active ? "Deactivate" : "Reactivate"}
              </Button>
            </div>
          )}
          <div className={cn(section, "border-rose-200 bg-rose-50/50 dark:border-rose-900/60 dark:bg-rose-950/20")}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-[#d70015] dark:text-[#ff6961]">Delete {person.name}</p>
                <p className="text-sm text-slate-600 dark:text-slate-400">{deleteNote ?? "They lose access immediately. Projects they created stay with the company."} This can't be undone.</p>
              </div>
              {!confirmDelete && <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>Delete</Button>}
            </div>
            {confirmDelete && (
              <div className="mt-4 flex flex-col gap-3 rounded-xl bg-white p-3 ring-1 ring-rose-200 dark:bg-slate-900 dark:ring-rose-900/60 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="h-4 w-4 shrink-0 text-[#d70015]" /> Permanently delete {person.email}?</p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                  <Button variant="danger" size="sm" loading={busy === "delete"} onClick={() => run("delete", () => api.del(basePath), `${person.name} deleted`, onClose)}>Yes, delete</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </Modal>
  );
}
