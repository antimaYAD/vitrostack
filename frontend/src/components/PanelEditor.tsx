import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, FileSpreadsheet, Plus, Trash2 } from "lucide-react";
import { api, type Panel } from "../lib/api";
import { cn, num } from "../lib/utils";
import { Button } from "./ui";

interface ParsedRow { window_tag: string; width_mm: number | null; height_mm: number | null; quantity: number; floor_level: string | null; glazing_notes: string | null; needs_review: boolean; review_reasons: string[] }

export function panelErrors(p: Panel): string | null {
  if (!p.width_mm || p.width_mm <= 0) return "Width required";
  if (!p.height_mm || p.height_mm <= 0) return "Height required";
  if (Math.min(p.width_mm, p.height_mm) > 2420 || Math.max(p.width_mm, p.height_mm) > 3640) return "Larger than a 3660×2440 jumbo sheet";
  if (!p.quantity || p.quantity < 1) return "Qty ≥ 1";
  return null;
}

const cell = "w-full rounded-md border-0 bg-transparent px-2 py-1.5 text-sm tabular-nums ring-1 ring-inset ring-transparent hover:ring-slate-200 focus:bg-white focus:ring-2 focus:ring-brand-600 dark:hover:ring-slate-700 dark:focus:bg-slate-950";

export default function PanelEditor({ panels, onChange }: { panels: Panel[]; onChange: (p: Panel[]) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const update = (i: number, patch: Partial<Panel>) => onChange(panels.map((p, j) => (j === i ? { ...p, ...patch, needs_review: false } : p)));
  const add = () => onChange([...panels, { tag: `W${panels.length + 1}`, width_mm: 0, height_mm: 0, quantity: 1 }]);
  const remove = (i: number) => onChange(panels.filter((_, j) => j !== i));

  const importFile = async (f: File) => {
    setImporting(true);
    try {
      const r = await api.upload<{ preview: { rows?: ParsedRow[]; error?: string; needs_review_count?: number } }>("/uploads", f);
      if (r.preview.error) throw new Error(r.preview.error);
      const rows = (r.preview.rows ?? []).map((x) => ({
        tag: x.window_tag, width_mm: x.width_mm ?? 0, height_mm: x.height_mm ?? 0, quantity: x.quantity || 1,
        floor_level: x.floor_level, notes: x.glazing_notes, needs_review: x.needs_review,
      }));
      onChange(rows);
      toast.success(`Imported ${rows.length} rows`, { description: r.preview.needs_review_count ? `${r.preview.needs_review_count} rows are highlighted for review` : "All dimensions normalised to mm" });
    } catch (e) {
      toast.error("Couldn't import schedule", { description: (e as Error).message });
    } finally {
      setImporting(false);
    }
  };

  const total = panels.reduce((a, p) => a + (p.quantity || 0), 0);
  const area = panels.reduce((a, p) => a + (p.width_mm * p.height_mm * (p.quantity || 0)) / 1e6, 0);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">{panels.length} types · {num(total)} panels · {num(area, 1)} m²</p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" loading={importing} icon={<FileSpreadsheet className="h-3.5 w-3.5" />} onClick={() => file.current?.click()}>Import CSV / Excel</Button>
          <Button type="button" variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={add}>Add row</Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/60">
            <tr>
              <th className="px-2 py-2 text-left font-medium">Tag</th>
              <th className="px-2 py-2 text-left font-medium">Width (mm)</th>
              <th className="px-2 py-2 text-left font-medium">Height (mm)</th>
              <th className="px-2 py-2 text-left font-medium">Qty</th>
              <th className="px-2 py-2 text-left font-medium">Floor</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {panels.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">No panels yet – add a row or import a schedule.</td></tr>
            )}
            {panels.map((p, i) => {
              const err = panelErrors(p);
              return (
                <tr key={i} className={cn("border-t border-slate-100 dark:border-slate-800", p.needs_review && "bg-amber-50/70 dark:bg-amber-950/20")}>
                  <td className="px-1 py-1"><input aria-label="Tag" className={cell} value={p.tag} onChange={(e) => update(i, { tag: e.target.value })} /></td>
                  <td className="px-1 py-1"><input aria-label="Width mm" inputMode="numeric" className={cn(cell, err?.startsWith("Width") && "ring-rose-300")} value={p.width_mm || ""} onChange={(e) => update(i, { width_mm: Number(e.target.value.replace(/\D/g, "")) })} placeholder="2400" /></td>
                  <td className="px-1 py-1"><input aria-label="Height mm" inputMode="numeric" className={cn(cell, err?.startsWith("Height") && "ring-rose-300")} value={p.height_mm || ""} onChange={(e) => update(i, { height_mm: Number(e.target.value.replace(/\D/g, "")) })} placeholder="1500" /></td>
                  <td className="px-1 py-1"><input aria-label="Quantity" inputMode="numeric" className={cell} value={p.quantity || ""} onChange={(e) => update(i, { quantity: Number(e.target.value.replace(/\D/g, "")) })} /></td>
                  <td className="px-1 py-1"><input aria-label="Floor" className={cell} value={p.floor_level ?? ""} onChange={(e) => update(i, { floor_level: e.target.value })} placeholder="—" /></td>
                  <td className="px-1 py-1">
                    <div className="flex items-center">
                      {(err || p.needs_review) && <span title={err ?? "Check this row – imported value was unclear"}><AlertCircle className={cn("h-4 w-4", err ? "text-rose-500" : "text-amber-500")} /></span>}
                      <button type="button" onClick={() => remove(i)} className="rounded p-1 text-slate-400 hover:text-rose-600" aria-label={`Remove ${p.tag}`}><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <input ref={file} type="file" accept=".csv,.xlsx,.xlsm" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
    </div>
  );
}
