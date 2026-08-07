/** What a page renders when the signed-in user may not view it. */
export function Forbidden({
  message = "You do not have access to this page.",
}: {
  message?: string;
}) {
  return (
    <div
      data-testid="forbidden-message"
      className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900"
    >
      {message}
    </div>
  );
}
