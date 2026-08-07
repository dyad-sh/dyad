"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  Field,
  FormError,
  inputClass,
  primaryButtonClass,
} from "@/components/ui-bits";

/** Submitting the clinic access code is the only way to become staff. */
export function StaffJoinForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const result = await apiFetch("/api/staff/claim", {
      method: "POST",
      body: { code },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="Clinic access code" htmlFor="staff-code-input">
        <input
          id="staff-code-input"
          data-testid="staff-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          className={inputClass}
        />
      </Field>
      <FormError testId="staff-code-error" message={error} />
      <button
        type="submit"
        data-testid="staff-code-submit"
        disabled={busy}
        className={primaryButtonClass}
      >
        {busy ? "Checking…" : "Join as staff"}
      </button>
    </form>
  );
}
