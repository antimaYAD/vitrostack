import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { cn, STATUS_META } from "../lib/utils";

// ---------------------------------------------------------------- Button (pill)

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-500 active:bg-brand-700 disabled:bg-brand-600/40",
  secondary: "bg-slate-100 text-[#1d1d1f] hover:bg-slate-200/80 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700",
  ghost: "text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-white/5",
  danger: "bg-[#e30000] text-white hover:bg-[#ff1a1a]",
  success: "bg-[#1a8f3a] text-white hover:bg-[#21a346]",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-normal transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]",
        VARIANTS[variant],
        size === "sm" && "h-8 px-3.5 text-[13px]",
        size === "md" && "h-9 px-[18px] text-sm",
        size === "lg" && "h-12 px-7 text-[17px]",
        size === "icon" && "h-9 w-9",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------- Card

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-[22px] border border-transparent bg-white shadow-card dark:bg-slate-900 dark:shadow-none", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-6 pb-2 pt-5">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 text-slate-400">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- Badge

const TONES: Record<string, string> = {
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  sky: "bg-[#e8f4fd] text-[#0071e3] dark:bg-[#0a84ff]/15 dark:text-[#64b5ff]",
  violet: "bg-[#f3eefc] text-[#7d3cd6] dark:bg-[#bf5af2]/15 dark:text-[#d58cf5]",
  emerald: "bg-[#e9f7ec] text-[#1a8f3a] dark:bg-[#30d158]/15 dark:text-[#4ade80]",
  amber: "bg-[#fff4e5] text-[#b25000] dark:bg-[#ff9f0a]/15 dark:text-[#ffb340]",
  rose: "bg-[#fdeceb] text-[#d70015] dark:bg-[#ff453a]/15 dark:text-[#ff6961]",
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
};

export function Badge({ tone = "slate", children, className, dot }: { tone?: string; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.draft;
  return <Badge tone={m.tone} dot>{m.label}</Badge>;
}

export function SafetyBadge({ safe }: { safe: boolean | null | undefined }) {
  if (safe === null || safe === undefined) return <Badge tone="slate">Not checked</Badge>;
  return safe ? <Badge tone="emerald">IS 875 pass</Badge> : <Badge tone="rose">Unsafe glass</Badge>;
}

// ---------------------------------------------------------------- Form controls (filled, Apple-style)

export function Field({ label, hint, error, children, htmlFor, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-slate-600 dark:text-slate-300">{label}</label>
      {children}
      {error ? <p className="text-xs text-[#d70015] dark:text-[#ff6961]">{error}</p> : hint ? <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}

const control = "block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] text-[#1d1d1f] transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/15 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-brand-500";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { suffix?: string; invalid?: boolean }>(
  function Input({ className, suffix, invalid, ...rest }, ref) {
    return (
      <div className="relative">
        <input ref={ref} className={cn(control, suffix && "pr-14", invalid && "border-[#d70015] focus:border-[#d70015] focus:ring-[#d70015]/15", className)} {...rest} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs text-slate-400">{suffix}</span>}
      </div>
    );
  },
);

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, "pr-9", className)} {...rest}>
      {children}
    </select>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; size?: "sm" | "md" }) {
  return (
    <div role="tablist" className="inline-flex rounded-full bg-slate-200/60 p-[3px] dark:bg-slate-800">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full transition-all duration-200",
            size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-[13px]",
            value === o.value ? "bg-white font-medium text-[#1d1d1f] shadow-[0_1px_4px_rgba(0,0,0,.12)] dark:bg-slate-600 dark:text-white" : "text-slate-600 hover:text-[#1d1d1f] dark:text-slate-400 dark:hover:text-white",
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="text-[11px] tabular-nums text-slate-400">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Feedback

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-slate-400", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("relative overflow-hidden rounded-xl bg-slate-200/50 dark:bg-slate-800", className)}><div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/5" /></div>;
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">{icon}</div>
      <h3 className="text-[21px] font-semibold text-[#1d1d1f] dark:text-white">{title}</h3>
      {body && <p className="mt-2 max-w-md text-[15px] leading-relaxed text-slate-500 dark:text-slate-400">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-[22px] bg-[#fdeceb] p-6 text-sm text-[#a0000f] dark:bg-[#ff453a]/10 dark:text-[#ff6961]">
      <p className="font-semibold">Couldn't load this</p>
      <p className="mt-1 opacity-90">{message}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Utilisation bar: green < 80%, amber < 100%, red ≥ 100%. */
export function UtilBar({ value, className, showLabel = true }: { value: number; className?: string; showLabel?: boolean }) {
  const pctV = value * 100;
  const color = pctV >= 100 ? "bg-[#ff3b30]" : pctV >= 80 ? "bg-[#ff9f0a]" : "bg-[#34c759]";
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800">
        <div className={cn("h-full rounded-full transition-all duration-700 ease-out", color)} style={{ width: `${Math.min(pctV, 100)}%` }} />
      </div>
      {showLabel && <span className={cn("w-12 text-right text-xs font-medium tabular-nums", pctV >= 100 ? "text-[#d70015] dark:text-[#ff6961]" : "text-slate-600 dark:text-slate-300")}>{pctV >= 99 && pctV < 101 ? pctV.toFixed(1) : Math.round(pctV)}%</span>}
    </div>
  );
}

export function Stat({ label, value, sub, icon, tone }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: "good" | "bad" | "neutral" }) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
        {icon && <div className="text-slate-300 dark:text-slate-600">{icon}</div>}
      </div>
      <p className="mt-3 text-[34px] font-semibold leading-none tracking-tightest text-[#1d1d1f] tabular-nums dark:text-white">{value}</p>
      {sub && <p className={cn("mt-2 text-[13px]", tone === "good" ? "text-[#1a8f3a] dark:text-[#4ade80]" : tone === "bad" ? "text-[#d70015] dark:text-[#ff6961]" : "text-slate-500 dark:text-slate-400")}>{sub}</p>}
    </Card>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md bg-slate-100 px-1.5 py-0.5 font-sans text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">{children}</kbd>;
}

// ---------------------------------------------------------------- Modal (sheet)

export function Modal({ open, onClose, title, description, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: "md" | "lg" | "xl" }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Callers often pass a new onClose on every render. Keep it in a ref so the effect below runs only when the
  // modal opens; otherwise each keystroke re-ran it and moved focus back to the first field.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    setTimeout(() => panel.current?.querySelector<HTMLElement>("input,select,textarea,button:not([data-close])")?.focus(), 30);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  // Portal to <body> so a modal opened from inside a table row or a blurred card is never clipped or layered under it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-md animate-fade-in" onClick={onClose} />
      <div ref={panel} className={cn("relative flex max-h-[92vh] w-full flex-col rounded-t-[28px] bg-white shadow-pop animate-fade-in dark:bg-slate-900 sm:rounded-[28px]", size === "md" && "sm:max-w-lg", size === "lg" && "sm:max-w-2xl", size === "xl" && "sm:max-w-4xl")}>
        <div className="flex items-start justify-between gap-4 px-7 pb-2 pt-7">
          <div>
            <h2 id={titleId} className="text-2xl font-semibold tracking-display text-[#1d1d1f] dark:text-white">{title}</h2>
            {description && <p className="mt-1 text-[15px] text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button data-close onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-7 py-5">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 px-7 pb-7 pt-3 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="truncate text-[32px] font-semibold leading-tight tracking-tightest text-[#1d1d1f] sm:text-[40px] dark:text-white">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[17px] leading-snug text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
