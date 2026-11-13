import { Fragment, useMemo, useState } from "react";
import { Check, RotateCw } from "lucide-react";
import type { Bom, Placement, Sheet } from "../lib/api";
import { cn, inr, num, STATUS_META } from "../lib/utils";

const PALETTE = ["#0891b2", "#7c3aed", "#059669", "#d97706", "#db2777", "#2563eb", "#65a30d", "#dc2626", "#0d9488", "#9333ea"];

export function useTagColors(tags: string[]) {
  return useMemo(() => {
    const m: Record<string, string> = {};
    [...new Set(tags)].forEach((t, i) => (m[t] = PALETTE[i % PALETTE.length]));
    return m;
  }, [tags.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** One jumbo sheet / offcut with its guillotine placements, drawn to scale. */
export function CuttingSheet({ sheet, colors, compact, highlight, onHover }: {
  sheet: Sheet; colors: Record<string, string>; compact?: boolean; highlight?: string | null; onHover?: (p: Placement | null) => void;
}) {
  const [hover, setHover] = useState<Placement | null>(null);
  const W = sheet.width_mm, H = sheet.height_mm;
  const fs = Math.max(W, H) / (compact ? 22 : 34);
  const set = (p: Placement | null) => { setHover(p); onHover?.(p); };
  const patternId = `hatch-${sheet.index}-${sheet.source}`;
  return (
    <div className="relative">
      <svg viewBox={`-20 -20 ${W + 40} ${H + 40}`} className="h-auto w-full" role="img"
        aria-label={`Sheet ${sheet.index}: ${sheet.placements.length} panels, ${sheet.utilisation_pct}% utilised`}>
        <defs>
          <pattern id={patternId} width="60" height="60" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="60" stroke="currentColor" strokeWidth="14" className="text-emerald-500/25" />
          </pattern>
        </defs>
        <rect x={0} y={0} width={W} height={H} rx={14} className={cn(sheet.source === "offcut" ? "fill-amber-50 stroke-amber-400 dark:fill-amber-950/30" : "fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600")} strokeWidth={8} strokeDasharray={sheet.source === "offcut" ? "40 24" : undefined} />
        {sheet.remnants.map((r, i) => (
          <g key={i}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={`url(#${patternId})`} className="stroke-emerald-500/50" strokeWidth={4} strokeDasharray="20 14" />
            {!compact && r.w > 500 && r.h > 300 && (
              <text x={r.x + r.w / 2} y={r.y + r.h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={fs * 0.75} className="fill-emerald-700 dark:fill-emerald-400" style={{ fontWeight: 500 }}>
                reusable {r.w}×{r.h}
              </text>
            )}
          </g>
        ))}
        {sheet.placements.map((p) => {
          const c = colors[p.tag] ?? "#0891b2";
          const dim = (highlight && highlight !== p.tag) || (hover && hover.uid !== p.uid);
          return (
            <g key={p.uid} onMouseEnter={() => set(p)} onMouseLeave={() => set(null)} className="cursor-default">
              <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={c} fillOpacity={dim ? 0.12 : 0.22} stroke={c} strokeWidth={hover?.uid === p.uid ? 14 : 6} rx={4} className="transition-all" />
              {p.w > fs * 3 && p.h > fs * 1.8 && (
                <>
                  <text x={p.x + p.w / 2} y={p.y + p.h / 2 - (compact ? 0 : fs * 0.45)} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fill={c} style={{ fontWeight: 600 }}>{compact ? p.tag : p.uid}</text>
                  {!compact && <text x={p.x + p.w / 2} y={p.y + p.h / 2 + fs * 0.75} textAnchor="middle" dominantBaseline="middle" fontSize={fs * 0.72} className="fill-slate-500 dark:fill-slate-400">{p.w}×{p.h}{p.rotated ? " ⟳" : ""}</text>}
                </>
              )}
            </g>
          );
        })}
      </svg>
      {hover && !compact && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-lg bg-slate-900/90 px-3 py-2 text-xs text-white shadow-pop">
          <p className="font-semibold">{hover.uid}</p>
          <p className="text-slate-300">{hover.w} × {hover.h} mm {hover.rotated && <span className="inline-flex items-center gap-1">· <RotateCw className="h-3 w-3" /> rotated</span>}</p>
          <p className="text-slate-400">at x {hover.x}, y {hover.y}</p>
        </div>
      )}
    </div>
  );
}

const STEPS = ["draft", "validated", "optimized", "quoted"];
const STEP_LABEL: Record<string, string> = { draft: "Schedule", validated: "IS 875 check", optimized: "Cutting plan", quoted: "Quote" };

export function StatusStepper({ status, unsafe }: { status: string; unsafe?: boolean }) {
  const cur = STATUS_META[status]?.step ?? 0;
  return (
    <ol className="flex w-full items-center">
      {STEPS.map((s, i) => {
        const done = i <= cur && !(i === 1 && unsafe);
        const blocked = i === 1 && unsafe;
        return (
          <li key={s} className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")}>
            <div className="flex items-center gap-2">
              <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-2",
                blocked ? "bg-rose-50 text-rose-600 ring-rose-300 dark:bg-rose-950" :
                  done ? "bg-brand-700 text-white ring-brand-700 dark:bg-brand-600 dark:ring-brand-600" : "bg-white text-slate-400 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700")}>
                {blocked ? "!" : done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn("hidden text-xs font-medium sm:inline", done ? "text-slate-900 dark:text-white" : blocked ? "text-rose-600" : "text-slate-400")}>{STEP_LABEL[s]}</span>
            </div>
            {i < STEPS.length - 1 && <div className={cn("mx-3 h-0.5 flex-1 rounded", i < cur && !(i === 0 && unsafe) ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-700")} />}
          </li>
        );
      })}
    </ol>
  );
}

export function BomTable({ bom }: { bom: Bom }) {
  const cats = [...new Set(bom.lines.map((l) => l.category))];
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr><th>Item</th><th className="text-right">Qty</th><th>Unit</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr>
        </thead>
        <tbody>
          {cats.map((c) => (
            <Fragment key={c}>
              <tr><td colSpan={5} className="bg-slate-50/60 !py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800/30">{c}</td></tr>
              {bom.lines.filter((l) => l.category === c).map((l, i) => (
                <tr key={c + i}>
                  <td className="max-w-xs">{l.item}</td>
                  <td className="text-right tabular-nums">{num(l.qty, l.qty % 1 ? 2 : 0)}</td>
                  <td className="text-slate-500">{l.unit}</td>
                  <td className="text-right tabular-nums text-slate-500">{inr(l.rate)}</td>
                  <td className="text-right font-medium tabular-nums">{inr(l.amount)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          <tr><td colSpan={4} className="font-semibold">Direct cost</td><td className="text-right font-semibold tabular-nums">{inr(bom.direct_cost)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

/** Small key-value metric used inside cards. */
export function Metric({ label, value, sub, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-white">{value}</p>
      {sub && <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}
