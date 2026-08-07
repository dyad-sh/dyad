"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SlotList } from "@/components/slot-list";
import {
  Field,
  FormError,
  inputClass,
  primaryButtonClass,
} from "@/components/ui-bits";
import { useOfferedSlots } from "@/hooks/use-slots";
import { apiFetch } from "@/lib/api-client";
import { CLINIC_TZ, clinicClockOf } from "@/lib/clinic-time";

/**
 * Move an existing booking. The practitioner and service are fixed, and the
 * offered list is the *same* server generator the write path re-checks against
 * — asked with this booking excluded, so it does not block itself.
 */
export function RescheduleForm({
  bookingId,
  practitionerId,
  serviceId,
}: {
  bookingId: string;
  practitionerId: string;
  serviceId: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { slots, loaded, error: slotsError } = useOfferedSlots(
    practitionerId,
    serviceId,
    date,
    bookingId,
  );

  useEffect(() => {
    setSelected("");
  }, [date]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!selected) {
      setError("Choose one of the available times.");
      return;
    }
    setBusy(true);
    const result = await apiFetch(`/api/bookings/${bookingId}/reschedule`, {
      method: "POST",
      body: { startAt: selected },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/bookings/${bookingId}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field label={`New date (${CLINIC_TZ})`} htmlFor="reschedule-date">
        <input
          id="reschedule-date"
          data-testid="reschedule-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={`${inputClass} max-w-xs`}
        />
      </Field>

      <SlotList
        slots={slots}
        loaded={loaded}
        selected={selected}
        onSelect={setSelected}
        listTestId="reschedule-slots-list"
      />

      {selected ? (
        <p
          data-testid="reschedule-selected-slot"
          data-slot-start={selected}
          className="text-sm text-slate-700"
        >
          Moving to {clinicClockOf(new Date(selected))} clinic time
        </p>
      ) : null}

      <FormError testId="reschedule-error" message={error || slotsError} />

      <button
        type="submit"
        data-testid="reschedule-submit"
        disabled={busy}
        className={primaryButtonClass}
      >
        {busy ? "Moving…" : "Reschedule"}
      </button>
    </form>
  );
}
