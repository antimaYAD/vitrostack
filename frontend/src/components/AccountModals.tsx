import { useState } from "react";
import { NavLink } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth, type User } from "../lib/auth";
import { cn } from "../lib/utils";
import { Button, Field, Input, Modal } from "./ui";

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "At least 8 characters";
  if (/^\d+$/.test(pw) || /^[a-zA-Z]+$/.test(pw)) return "Use a mix of letters and numbers";
  return null;
}

/** Change own password. `forced` = first sign-in with a temporary password (can't be dismissed). */
export function ChangePasswordModal({ open, onClose, forced }: { open: boolean; onClose: () => void; forced?: boolean }) {
  const { setUser, logout } = useAuth();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const problem = next ? passwordProblem(next) : null;
  const mismatch = confirm && next !== confirm ? "Passwords don't match" : null;

  const submit = async () => {
    if (!cur || !next || problem || mismatch || next !== confirm) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ user: User }>("/auth/password", { current_password: cur, new_password: next });
      setUser(r.user);
      toast.success("Password updated", { description: "Other devices were signed out." });
      setCur(""); setNext(""); setConfirm("");
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={forced ? () => {} : onClose} title={forced ? "Choose a new password" : "Change password"}
      description={forced ? "You signed in with a temporary password. Set your own to continue." : "You'll stay signed in on this device."}
      footer={<>
        {forced ? <Button variant="secondary" onClick={logout}>Sign out</Button> : <Button variant="secondary" onClick={onClose}>Cancel</Button>}
        <Button loading={busy} onClick={submit} disabled={!cur || !next || !!problem || !!mismatch || next !== confirm}>Update password</Button>
      </>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label={forced ? "Temporary password" : "Current password"} htmlFor="pw-cur" error={err}>
          <Input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} invalid={!!err} />
        </Field>
        <Field label="New password" htmlFor="pw-new" error={problem} hint="8+ characters with letters and numbers">
          <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} invalid={!!problem} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-conf" error={mismatch}>
          <Input id="pw-conf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={!!mismatch} />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

export function AdminTabs() {
  const tab = (to: string, label: string) => (
    <NavLink to={to} className={({ isActive }) => cn("rounded-full px-4 py-1.5 text-[13px] transition", isActive ? "bg-white font-medium text-[#1d1d1f] shadow-[0_1px_4px_rgba(0,0,0,.12)] dark:bg-slate-600 dark:text-white" : "text-slate-600 hover:text-[#1d1d1f] dark:text-slate-400")}>{label}</NavLink>
  );
  return <div className="inline-flex rounded-full bg-slate-200/60 p-[3px] dark:bg-slate-800">{tab("/admin/pricing", "Pricing")}{tab("/admin/users", "Users")}</div>;
}
