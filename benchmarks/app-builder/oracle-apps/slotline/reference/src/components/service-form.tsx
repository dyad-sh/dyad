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

export interface ServiceFormValues {
  id: string;
  name: string;
  durationMinutes: number;
}

export function ServiceForm({
  service,
  onSaved,
}: {
  service?: ServiceFormValues;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(service?.name ?? "");
  const [duration, setDuration] = useState(
    service ? String(service.durationMinutes) : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    // The raw string goes to the server: whether `0`, `1.5` or `abc` is a legal
    // duration is a server decision, not something the input type enforces.
    const result = await apiFetch(
      service ? `/api/services/${service.id}` : "/api/services",
      {
        method: service ? "PATCH" : "POST",
        body: { name, durationMinutes: duration },
      },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (service) {
      onSaved?.();
      router.refresh();
    } else {
      router.push("/services");
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="Name" htmlFor="service-form-name">
        <input
          id="service-form-name"
          data-testid="service-form-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Duration (minutes)" htmlFor="service-form-duration">
        <input
          id="service-form-duration"
          data-testid="service-form-duration"
          type="number"
          step={1}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className={inputClass}
        />
      </Field>
      <FormError testId="service-form-error" message={error} />
      <button
        type="submit"
        data-testid="service-form-submit"
        disabled={busy}
        className={primaryButtonClass}
      >
        {busy ? "Saving…" : service ? "Save changes" : "Add service"}
      </button>
    </form>
  );
}
