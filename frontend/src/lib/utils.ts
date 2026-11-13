import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export { clsx as cn } from "clsx";

export function inr(v: number | null | undefined, opts: { compact?: boolean; decimals?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (opts.compact) {
    const a = Math.abs(v);
    if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
    if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
    if (a >= 1e3) return `₹${(v / 1e3).toFixed(1)}k`;
  }
  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: opts.decimals ? 2 : 0, minimumFractionDigits: opts.decimals ? 2 : 0 });
}

export const num = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });

export function pct(u: number): string {
  const v = u * 100;
  return v >= 99 && v < 101 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function specLabel(key: string | null | undefined): string {
  if (!key) return "—";
  const m = key.match(/^([\d.]+)mm_(\w+)$/);
  if (!m) return key;
  const [, t, kind] = m;
  if (kind === "laminated") {
    const total = parseFloat(t);
    const ply = Math.round((total - 1.52) / 2);
    return `${ply}+${ply} mm laminated`;
  }
  return `${t} mm ${kind.replace("_", "-")}`;
}

/** Fetch helper with loading/error state and manual reload. */
export function useApi<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const seq = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!url) return;
    const id = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const d = await api.get<T>(url);
      if (id === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError((e as Error).message);
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, setData, error, loading, reload: load };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const STATUS_META: Record<string, { label: string; tone: string; step: number }> = {
  draft: { label: "Draft", tone: "slate", step: 0 },
  validated: { label: "Validated", tone: "sky", step: 1 },
  optimized: { label: "Optimized", tone: "violet", step: 2 },
  quoted: { label: "Quoted", tone: "emerald", step: 3 },
};
