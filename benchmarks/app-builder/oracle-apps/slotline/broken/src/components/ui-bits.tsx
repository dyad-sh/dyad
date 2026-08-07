import Link from "next/link";
import type { ReactNode } from "react";

/** Small presentational primitives shared by every page. */

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export const primaryButtonClass =
  "inline-flex items-center rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60";

export const secondaryButtonClass =
  "inline-flex items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60";

export const dangerButtonClass =
  "inline-flex items-center rounded-lg border border-red-300 bg-white px-3.5 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60";

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
    </div>
  );
}

export function FormError({
  testId,
  message,
}: {
  testId: string;
  message: string;
}) {
  if (!message) return null;
  return (
    <p
      data-testid={testId}
      role="alert"
      className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {message}
    </p>
  );
}

export function EmptyState({
  testId,
  title,
  hint,
}: {
  testId: string;
  title: string;
  hint?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center"
    >
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function LinkButton({
  href,
  testId,
  children,
}: {
  href: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} data-testid={testId} className={primaryButtonClass}>
      {children}
    </Link>
  );
}
