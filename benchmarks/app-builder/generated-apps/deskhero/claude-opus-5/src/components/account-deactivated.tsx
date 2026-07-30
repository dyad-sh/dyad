import { SignOutButton } from "@/components/sign-out-button";

export function AccountDeactivated() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div
        data-testid="account-deactivated"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-900/5"
      >
        <h1 className="text-lg font-semibold text-slate-900">
          Your account has been deactivated
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          An administrator has deactivated this account, so Deskhero is no
          longer available to you. Contact your admin if you think this is a
          mistake.
        </p>
        <div className="mt-6 flex justify-center">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
