export function DeactivatedNotice() {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-red-200 bg-red-50 p-6 text-center">
      <p data-testid="account-deactivated" className="text-sm text-red-700">
        Your account has been deactivated. Contact an administrator for
        access.
      </p>
    </div>
  );
}
