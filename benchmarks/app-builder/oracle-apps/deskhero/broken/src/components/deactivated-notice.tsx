/**
 * Server-rendered notice for a session whose account has been deactivated.
 * The session cookie is still cryptographically valid, so the server accepts
 * the request and then rejects the *account*: no data is rendered, and every
 * API the page would call answers 401/403 for the same user.
 */
export function DeactivatedNotice() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <div
        data-testid="account-deactivated"
        className="rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center"
        role="alert"
      >
        <h1 className="text-2xl font-bold tracking-tight text-red-800">
          This account has been deactivated
        </h1>
        <p className="mt-3 text-sm text-red-700">
          An administrator has deactivated your Deskhero account. Contact your
          helpdesk administrator if you think this is a mistake.
        </p>
      </div>
    </main>
  );
}
