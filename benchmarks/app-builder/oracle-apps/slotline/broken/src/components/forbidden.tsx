/** The pinned denial surface for a page the caller's role may not view. */
export function Forbidden({
  message = "Only clinic staff can open this page.",
}: {
  message?: string;
}) {
  return (
    <div
      data-testid="forbidden-message"
      role="alert"
      className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-10 text-center"
    >
      <p className="text-sm font-medium text-amber-900">{message}</p>
      <p className="mt-1 text-sm text-amber-800">
        Ask a member of clinic staff if you need access.
      </p>
    </div>
  );
}
