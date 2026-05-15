import { cn } from "@/lib/utils";

const avatarPalette = [
  "bg-gradient-to-br from-red-200 to-rose-300 text-red-900 shadow-sm shadow-red-300/40 dark:from-red-900/40 dark:to-rose-900/40 dark:text-red-100",
  "bg-gradient-to-br from-rose-200 to-pink-300 text-rose-900 shadow-sm shadow-rose-300/40 dark:from-rose-900/40 dark:to-pink-900/40 dark:text-rose-100",
  "bg-gradient-to-br from-pink-200 to-fuchsia-300 text-pink-900 shadow-sm shadow-pink-300/40 dark:from-pink-900/40 dark:to-fuchsia-900/40 dark:text-pink-100",
  "bg-gradient-to-br from-fuchsia-200 to-purple-300 text-fuchsia-900 shadow-sm shadow-fuchsia-300/40 dark:from-fuchsia-900/40 dark:to-purple-900/40 dark:text-fuchsia-100",
  "bg-gradient-to-br from-purple-200 to-violet-300 text-purple-900 shadow-sm shadow-purple-300/40 dark:from-purple-900/40 dark:to-violet-900/40 dark:text-purple-100",
  "bg-gradient-to-br from-violet-200 to-indigo-300 text-violet-900 shadow-sm shadow-violet-300/40 dark:from-violet-900/40 dark:to-indigo-900/40 dark:text-violet-100",
  "bg-gradient-to-br from-indigo-200 to-blue-300 text-indigo-900 shadow-sm shadow-indigo-300/40 dark:from-indigo-900/40 dark:to-blue-900/40 dark:text-indigo-100",
  "bg-gradient-to-br from-blue-200 to-sky-300 text-blue-900 shadow-sm shadow-blue-300/40 dark:from-blue-900/40 dark:to-sky-900/40 dark:text-blue-100",
  "bg-gradient-to-br from-sky-200 to-cyan-300 text-sky-900 shadow-sm shadow-sky-300/40 dark:from-sky-900/40 dark:to-cyan-900/40 dark:text-sky-100",
  "bg-gradient-to-br from-cyan-200 to-teal-300 text-cyan-900 shadow-sm shadow-cyan-300/40 dark:from-cyan-900/40 dark:to-teal-900/40 dark:text-cyan-100",
  "bg-gradient-to-br from-teal-200 to-emerald-300 text-teal-900 shadow-sm shadow-teal-300/40 dark:from-teal-900/40 dark:to-emerald-900/40 dark:text-teal-100",
  "bg-gradient-to-br from-emerald-200 to-green-300 text-emerald-900 shadow-sm shadow-emerald-300/40 dark:from-emerald-900/40 dark:to-green-900/40 dark:text-emerald-100",
  "bg-gradient-to-br from-green-200 to-lime-300 text-green-900 shadow-sm shadow-green-300/40 dark:from-green-900/40 dark:to-lime-900/40 dark:text-green-100",
  "bg-gradient-to-br from-lime-200 to-yellow-300 text-lime-900 shadow-sm shadow-lime-300/40 dark:from-lime-900/40 dark:to-yellow-900/40 dark:text-lime-100",
  "bg-gradient-to-br from-yellow-200 to-amber-300 text-yellow-900 shadow-sm shadow-yellow-300/40 dark:from-yellow-900/40 dark:to-amber-900/40 dark:text-yellow-100",
  "bg-gradient-to-br from-amber-200 to-orange-300 text-amber-900 shadow-sm shadow-amber-300/40 dark:from-amber-900/40 dark:to-orange-900/40 dark:text-amber-100",
];

export function getAppInitials(name: string): string {
  const segments = name.split(/[-_\s]+/).filter(Boolean);
  if (segments.length >= 2) {
    return (segments[0][0] + segments[1][0]).toUpperCase();
  }
  if (segments.length === 1) {
    return segments[0].slice(0, 2).toUpperCase();
  }
  return "??";
}

export function AppAvatar({
  appId,
  name,
  className,
}: {
  appId: number;
  name: string;
  className?: string;
}) {
  const colorClass =
    avatarPalette[(Math.abs(appId) * 7) % avatarPalette.length];
  return (
    <div
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold",
        colorClass,
        className,
      )}
      aria-hidden="true"
    >
      {getAppInitials(name)}
    </div>
  );
}
