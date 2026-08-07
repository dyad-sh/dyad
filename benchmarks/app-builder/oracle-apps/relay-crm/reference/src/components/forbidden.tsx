export function Forbidden({
  message = "Your role does not allow this action.",
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
