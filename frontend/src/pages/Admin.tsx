import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { History, Lock, Percent, RotateCcw, Save, Undo2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { cn, inr, timeAgo, useApi } from "../lib/utils";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Input, Modal, PageHeader, Skeleton } from "../components/ui";
import { useApp } from "../components/Layout";
import { AdminTabs } from "../components/AccountModals";

type Prices = Record<string, Record<string, number>>;
type Draft = Record<string, Record<string, string>>;
interface SchemaItem { label: string; unit?: string; max?: number }
interface Section { title: string; description: string; unit?: string; items: Record<string, SchemaItem> }
interface PriceResp { prices: Prices; defaults: Prices; schema: Record<string, Section>; updated_at: string | null }
interface Change { id: number; section: string; item: string; old_value: number | null; new_value: number; changed_by: string | null; created_at: string }

const toDraft = (p: Prices): Draft => Object.fromEntries(Object.entries(p).map(([s, items]) => [s, Object.fromEntries(Object.entries(items).map(([k, v]) => [k, String(v)]))]));
const fmt = (v: number, unit?: string) => (unit?.startsWith("%") ? `${v}%` : inr(v, { decimals: v % 1 !== 0 }));

export default function Admin() {
  const { data, error, loading, reload, setData } = useApi<PriceResp>("/admin/prices");
  const history = useApi<Change[]>("/admin/prices/history");
  const { refreshReference } = useApp();
  const [draft, setDraft] = useState<Draft>({});
  const [bulk, setBulk] = useState("");
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data) setDraft(toDraft(data.prices)); }, [data]);

  const unitOf = (s: string, k: string) => data?.schema[s].items[k].unit ?? data?.schema[s].unit ?? "";
  const errorOf = (s: string, k: string): string | null => {
    const raw = draft[s]?.[k] ?? "";
    if (raw.trim() === "") return "Required";
    const v = Number(raw);
    if (Number.isNaN(v)) return "Enter a number";
    if (v < 0) return "Can't be negative";
    const max = data?.schema[s].items[k].max;
    if (max !== undefined && v > max) return `Max ${max}`;
    return null;
  };

  const changes = useMemo(() => {
    if (!data) return [];
    const out: { s: string; k: string; old: number; next: number }[] = [];
    for (const [s, items] of Object.entries(draft)) for (const [k, raw] of Object.entries(items)) {
      const v = Number(raw);
      if (raw.trim() !== "" && !Number.isNaN(v) && v !== data.prices[s][k]) out.push({ s, k, old: data.prices[s][k], next: v });
    }
    return out;
  }, [draft, data]);
  const invalid = data ? Object.entries(draft).some(([s, items]) => Object.keys(items).some((k) => errorOf(s, k))) : false;
  const dirty = changes.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (s: string, k: string, v: string) => setDraft((d) => ({ ...d, [s]: { ...d[s], [k]: v } }));

  const applyBulk = () => {
    const pctV = Number(bulk);
    if (!bulk || Number.isNaN(pctV) || pctV <= -100) return toast.error("Enter a percentage, e.g. 5 or -3");
    setDraft((d) => ({ ...d, glass: Object.fromEntries(Object.entries(d.glass).map(([k, v]) => [k, String(Math.round((Number(v) * (1 + pctV / 100)) / 10) * 10)])) }));
    toast.success(`Glass rates ${pctV > 0 ? "increased" : "reduced"} by ${Math.abs(pctV)}% (rounded to ₹10). Review and save.`);
    setBulk("");
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const prices = Object.fromEntries(Object.entries(draft).map(([s, items]) => [s, Object.fromEntries(Object.entries(items).map(([k, v]) => [k, Number(v)]))]));
      const r = await api.put<{ prices: Prices; updated_at: string }>("/admin/prices", { prices });
      setData({ ...data, prices: r.prices, updated_at: r.updated_at });
      setReview(false);
      history.reload(true);
      refreshReference();
      toast.success(`${changes.length} price${changes.length > 1 ? "s" : ""} updated`, { description: "New quotes and previews use these prices immediately. Existing quotes keep theirs until re-quoted." });
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 403 ? "Only admins can change prices" : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={() => reload()} />;

  return (
    <div className={cn(dirty && "pb-24")}>
      <PageHeader eyebrow={<AdminTabs />} title="Pricing"
        subtitle="Rates used by every BOM, quote preview and quotation PDF. Changes apply to new quotes immediately."
        actions={data && <>
          <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setDraft(toDraft(data.defaults))}>Load defaults</Button>
          <Button icon={<Save className="h-4 w-4" />} disabled={!dirty || invalid} onClick={() => setReview(true)}>Review & save</Button>
        </>} />

      {loading || !data ? (
        <div className="grid gap-6 lg:grid-cols-3"><Skeleton className="h-96 lg:col-span-2" /><Skeleton className="h-64" /></div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {Object.entries(data.schema).map(([s, sec]) => (
              <Card key={s}>
                <CardHeader title={sec.title} subtitle={sec.description || undefined}
                  action={s === "glass" ? (
                    <div className="flex items-center gap-2">
                      <div className="w-28"><Input value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="±5" suffix="%" inputMode="decimal" aria-label="Bulk adjust glass rates by percent" onKeyDown={(e) => e.key === "Enter" && applyBulk()} /></div>
                      <Button variant="secondary" size="sm" icon={<Percent className="h-3.5 w-3.5" />} onClick={applyBulk}>Adjust all</Button>
                    </div>
                  ) : undefined} />
                <div className="divide-y divide-slate-100 px-6 pb-3 dark:divide-slate-800">
                  {Object.entries(sec.items).map(([k, item]) => {
                    const saved = data.prices[s][k];
                    const def = data.defaults[s][k];
                    const v = Number(draft[s]?.[k]);
                    const err = errorOf(s, k);
                    const changed = !err && v !== saved;
                    const delta = changed && saved ? ((v - saved) / saved) * 100 : null;
                    const unit = unitOf(s, k);
                    return (
                      <div key={k} className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <label htmlFor={`p-${s}-${k}`} className="flex items-center gap-2 text-[15px] text-[#1d1d1f] dark:text-white">
                            {changed && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unsaved change" />}
                            {item.label}
                          </label>
                          <p className="text-xs text-slate-500">{unit} · default {fmt(def, unit)}{saved !== def && <> · <button className="link" onClick={() => set(s, k, String(def))}>use default</button></>}</p>
                        </div>
                        <div className="flex items-center gap-2 sm:w-64 sm:justify-end">
                          {delta !== null && Number.isFinite(delta) && <Badge tone={delta > 0 ? "amber" : "emerald"}>{delta > 0 ? "+" : ""}{delta.toFixed(1)}%</Badge>}
                          {changed && <button onClick={() => set(s, k, String(saved))} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label={`Undo ${item.label}`} title={`Undo (saved: ${fmt(saved, unit)})`}><Undo2 className="h-4 w-4" /></button>}
                          <div className="w-36">
                            <Input id={`p-${s}-${k}`} inputMode="decimal" value={draft[s]?.[k] ?? ""} invalid={!!err} onChange={(e) => set(s, k, e.target.value.replace(/[^\d.-]/g, ""))}
                              suffix={unit.startsWith("%") ? "%" : "₹"} className="text-right tabular-nums" aria-invalid={!!err} />
                          </div>
                        </div>
                        {err && <p className="text-xs text-[#d70015] sm:hidden">{err}</p>}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>

          <div className="space-y-6">
            <Card className="p-6">
              <p className="text-[13px] text-slate-500">Price list last changed</p>
              <p className="mt-1 text-[21px] font-semibold">{data.updated_at ? timeAgo(data.updated_at) : "Using defaults"}</p>
              {data.updated_at && <p className="text-xs text-slate-500">{new Date(data.updated_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>}
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Only admins can see and change prices. Changes are logged under your name.
              </div>
            </Card>
            <Card>
              <CardHeader title="Change history" icon={<History className="h-4 w-4" />} />
              <div className="px-3 pb-3">
                {history.data && history.data.length === 0 && <EmptyState icon={<History className="h-5 w-5" />} title="No changes yet" body="Every saved price change is logged here." />}
                <ul>
                  {history.data?.slice(0, 15).map((c) => {
                    const label = data.schema[c.section]?.items[c.item]?.label ?? c.item;
                    const unit = unitOf(c.section, c.item);
                    return (
                      <li key={c.id} className="rounded-xl px-3 py-2.5 text-sm">
                        <p className="truncate text-[#1d1d1f] dark:text-white" title={label}>{label}</p>
                        <p className="text-xs text-slate-500">
                          {c.old_value !== null && <span className="line-through">{fmt(c.old_value, unit)}</span>} → <span className="font-medium text-slate-700 dark:text-slate-300">{fmt(c.new_value, unit)}</span>
                          {" · "}{c.changed_by ?? "Unknown"} · {timeAgo(c.created_at)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Sticky unsaved bar */}
      {dirty && data && (
        <div className="fixed inset-x-0 bottom-5 z-30 flex justify-center px-4 animate-fade-in">
          <div className="glass-nav flex items-center gap-4 rounded-full py-2 pl-5 pr-2 shadow-pop ring-1 ring-black/5 dark:ring-white/10">
            <span className="text-sm">{changes.length} unsaved change{changes.length > 1 ? "s" : ""}{invalid && <span className="text-[#d70015]"> · fix errors</span>}</span>
            <Button variant="ghost" size="sm" onClick={() => setDraft(toDraft(data.prices))}>Discard</Button>
            <Button size="sm" disabled={invalid} onClick={() => setReview(true)}>Review & save</Button>
          </div>
        </div>
      )}

      <Modal open={review} onClose={() => setReview(false)} size="lg" title="Review price changes" description="New quotes will use these prices as soon as you save."
        footer={<><Button variant="secondary" onClick={() => setReview(false)}>Back</Button><Button loading={saving} onClick={save}>Save {changes.length} change{changes.length > 1 ? "s" : ""}</Button></>}>
        <div className="space-y-5">
          <div className="overflow-hidden rounded-2xl bg-slate-50 dark:bg-slate-800/50">
            <table className="table-base">
              <thead><tr><th>Item</th><th className="text-right">Current</th><th className="text-right">New</th><th className="text-right">Change</th></tr></thead>
              <tbody>
                {changes.map((c) => {
                  const unit = unitOf(c.s, c.k);
                  const d = c.old ? ((c.next - c.old) / c.old) * 100 : null;
                  return (
                    <tr key={`${c.s}.${c.k}`}>
                      <td>{data?.schema[c.s].items[c.k].label}</td>
                      <td className="text-right tabular-nums text-slate-500">{fmt(c.old, unit)}</td>
                      <td className="text-right font-medium tabular-nums">{fmt(c.next, unit)}</td>
                      <td className="text-right">{d !== null && <Badge tone={d > 0 ? "amber" : "emerald"}>{d > 0 ? "+" : ""}{d.toFixed(1)}%</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}
