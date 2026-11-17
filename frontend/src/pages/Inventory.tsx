import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Boxes, Plus, Trash2 } from "lucide-react";
import { api, type Offcut } from "../lib/api";
import { cn, inr, num, specLabel, timeAgo, useApi } from "../lib/utils";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Segmented, Skeleton, Stat } from "../components/ui";
import { GlassSelect } from "../components/ProjectForm";
import { useApp } from "../components/Layout";
import { useAuth } from "../lib/auth";

function Thumb({ w, h }: { w: number; h: number }) {
  const s = 40 / 3660;
  return (
    <div className="flex h-10 w-12 items-center justify-center">
      <div className="rounded-sm border border-brand-400 bg-brand-100/70 dark:bg-brand-900/40" style={{ width: Math.max(4, w * s), height: Math.max(4, h * s) }} />
    </div>
  );
}

export default function Inventory() {
  const { data, error, loading, reload } = useApi<Offcut[]>("/offcuts");
  const { reference } = useApp();
  const { isAdmin } = useAuth();
  const [spec, setSpec] = useState("all");
  const [status, setStatus] = useState<"available" | "reserved" | "all">("available");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ glass_spec: "12mm_toughened", width_mm: "", height_mm: "", rack: "", quantity: "1" });
  const [saving, setSaving] = useState(false);

  const specs = useMemo(() => [...new Set((data ?? []).map((o) => o.glass_spec))], [data]);
  const rows = (data ?? []).filter((o) => (spec === "all" || o.glass_spec === spec) && (status === "all" || o.status === status));
  const avail = (data ?? []).filter((o) => o.status === "available");
  const value = avail.reduce((a, o) => a + o.area_m2 * (reference?.glass.find((g) => g.key === o.glass_spec)?.rate_per_sqm ?? 0), 0);

  const w = Number(f.width_mm), h = Number(f.height_mm);
  const formErr = !w || !h ? "Enter both dimensions" : Math.max(w, h) > 3660 || Math.min(w, h) > 2440 ? "Larger than a jumbo sheet" : Math.min(w, h) < 100 ? "Pieces under 100 mm aren't worth tracking" : null;

  const add = async () => {
    if (formErr) return;
    setSaving(true);
    try {
      await api.post("/offcuts", { glass_spec: f.glass_spec, width_mm: w, height_mm: h, rack: f.rack || null, quantity: Number(f.quantity) || 1 });
      toast.success(`Added ${Number(f.quantity) > 1 ? `${f.quantity} offcuts` : "offcut"} to inventory`);
      setOpen(false);
      setF({ ...f, width_mm: "", height_mm: "", quantity: "1" });
      reload(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (o: Offcut) => {
    try {
      await api.del(`/offcuts/${o.id}`);
      toast.success(`Offcut #${o.id} removed`);
      reload(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div>
      <PageHeader title="Offcut inventory" subtitle="Leftover glass the optimizer uses before opening a new jumbo sheet." actions={isAdmin ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Add offcut</Button> : undefined} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {loading ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[110px] rounded-xl" />) : (
          <>
            <Stat label="Available pieces" value={avail.length} sub={`${specs.length} glass types`} />
            <Stat label="Available area" value={`${num(avail.reduce((a, o) => a + o.area_m2, 0), 1)} m²`} />
            <Stat label="Stock value" value={inr(value, { compact: true })} sub="At current glass rates" />
            <Stat label="Reserved by plans" value={(data ?? []).filter((o) => o.status === "reserved").length} sub="Locked to cutting plans" />
          </>
        )}
      </div>

      {error && <ErrorState message={error} onRetry={() => reload()} />}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <div className="overflow-x-auto"><Segmented size="sm" value={spec} onChange={setSpec} options={[{ value: "all", label: "All glass" }, ...specs.map((s) => ({ value: s, label: specLabel(s) }))]} /></div>
          <Segmented size="sm" value={status} onChange={setStatus} options={[{ value: "available", label: "Available" }, { value: "reserved", label: "Reserved" }, { value: "all", label: "All" }]} />
        </div>
        {data && rows.length === 0 ? (
          <EmptyState icon={<Boxes className="h-6 w-6" />} title={data.length ? "Nothing matches these filters" : "No offcuts yet"} body={isAdmin ? "Save remnants from a cutting plan, or add pieces from the factory racks." : "Only an admin can add offcuts to the inventory."} action={isAdmin ? <Button variant="secondary" onClick={() => setOpen(true)}>Add offcut</Button> : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th className="w-14" /><th>ID</th><th>Glass</th><th>Size (mm)</th><th className="text-right">Area</th><th>Rack</th><th>Source</th><th>Status</th><th>Added</th><th /></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={10}><Skeleton className="h-8" /></td></tr>}
                {rows.map((o) => (
                  <tr key={o.id} className="group">
                    <td><Thumb w={o.width_mm} h={o.height_mm} /></td>
                    <td className="font-mono text-xs">#{o.id}</td>
                    <td className="whitespace-nowrap">{o.glass_label}</td>
                    <td className="whitespace-nowrap tabular-nums">{o.width_mm} × {o.height_mm}</td>
                    <td className="text-right tabular-nums">{o.area_m2} m²</td>
                    <td>{o.rack ?? "—"}</td>
                    <td className="max-w-[180px] truncate text-xs text-slate-500" title={o.source ?? ""}>{o.source ?? "—"}</td>
                    <td>{o.status === "available" ? <Badge tone="emerald" dot>Available</Badge> : o.status === "reserved" ? <Link to={`/projects/${o.reserved_for}?tab=cutting`}><Badge tone="violet" dot>Reserved</Badge></Link> : <Badge>Used</Badge>}</td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{timeAgo(o.created_at)}</td>
                    <td>
                      <button onClick={() => remove(o)} disabled={o.status === "reserved"} title={o.status === "reserved" ? "Reserved by a cutting plan" : "Remove (scrapped / used elsewhere)"}
                        className={cn("rounded p-1 text-slate-400 opacity-0 transition group-hover:opacity-100 focus:opacity-100", o.status === "reserved" ? "cursor-not-allowed" : "hover:text-rose-600")} aria-label={`Remove offcut ${o.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open && isAdmin} onClose={() => setOpen(false)} title="Add offcut" description="Record a usable piece from the factory racks."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={add} loading={saving} disabled={!!formErr}>Add to inventory</Button></>}>
        <div className="space-y-4">
          <Field label="Glass" htmlFor="o-g"><GlassSelect id="o-g" value={f.glass_spec} onChange={(v) => setF({ ...f, glass_spec: v })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Width" htmlFor="o-w"><Input id="o-w" type="number" value={f.width_mm} onChange={(e) => setF({ ...f, width_mm: e.target.value })} suffix="mm" /></Field>
            <Field label="Height" htmlFor="o-h"><Input id="o-h" type="number" value={f.height_mm} onChange={(e) => setF({ ...f, height_mm: e.target.value })} suffix="mm" /></Field>
            <Field label="Rack / location" htmlFor="o-r"><Input id="o-r" value={f.rack} onChange={(e) => setF({ ...f, rack: e.target.value })} placeholder="R-07" /></Field>
            <Field label="Quantity" htmlFor="o-q"><Input id="o-q" type="number" min={1} max={100} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          </div>
          {f.width_mm && f.height_mm && formErr && <p className="text-xs text-rose-600">{formErr}</p>}
        </div>
      </Modal>
    </div>
  );
}
