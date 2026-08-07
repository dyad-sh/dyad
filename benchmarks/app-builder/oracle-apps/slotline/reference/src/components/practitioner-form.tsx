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

export interface PractitionerFormValues {
  id: string;
  name: string;
  specialty: string;
}

/**
 * Create and edit share one form: the server validates the same body either
 * way, and the pinned `practitioner-form-error` shows whatever it says.
 */
export function PractitionerForm({
  practitioner,
  onSaved,
}: {
  practitioner?: PractitionerFormValues;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(practitioner?.name ?? "");
  const [specialty, setSpecialty] = useState(practitioner?.specialty ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const result = await apiFetch(
      practitioner ? `/api/practitioners/${practitioner.id}` : "/api/practitioners",
      { method: practitioner ? "PATCH" : "POST", body: { name, specialty } },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (practitioner) {
      onSaved?.();
      router.refresh();
    } else {
      router.push(`/practitioners/${result.data.id}`);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="Name" htmlFor="practitioner-form-name">
        <input
          id="practitioner-form-name"
          data-testid="practitioner-form-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Specialty" htmlFor="practitioner-form-specialty">
        <input
          id="practitioner-form-specialty"
          data-testid="practitioner-form-specialty"
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
          className={inputClass}
        />
      </Field>
      <FormError testId="practitioner-form-error" message={error} />
      <button
        type="submit"
        data-testid="practitioner-form-submit"
        disabled={busy}
        className={primaryButtonClass}
      >
        {busy ? "Saving…" : practitioner ? "Save changes" : "Add practitioner"}
      </button>
    </form>
  );
}
