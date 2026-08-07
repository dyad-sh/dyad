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

export interface Option {
  id: string;
  name: string;
}

/**
 * Pick a practitioner, a service and a clinic-local date, then book one of the
 * slots the *server* says are available. The browser sends back the exact
 * instant it was offered, and the server re-checks it before writing.
 */
export function BookingForm({
  practitioners,
  services,
}: {
  practitioners: Option[];
  services: Option[];
}) {
  const router = useRouter();
  const [practitionerId, setPractitionerId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState("");
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { slots, loaded, error: slotsError } = useOfferedSlots(
    practitionerId,
    serviceId,
    date,
  );

  // A slot picked for one practitioner/service/day means nothing on another.
  useEffect(() => {
    setSelected("");
  }, [practitionerId, serviceId, date]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!selected) {
      setError("Choose one of the available times.");
      return;
    }
    setBusy(true);
    const result = await apiFetch("/api/bookings", {
      method: "POST",
      body: { practitionerId, serviceId, startAt: selected },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push("/bookings");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Practitioner" htmlFor="booking-form-practitioner">
          <select
            id="booking-form-practitioner"
            data-testid="booking-form-practitioner"
            value={practitionerId}
            onChange={(e) => setPractitionerId(e.target.value)}
            className={inputClass}
          >
            <option value="">Choose a practitioner</option>
            {practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Service" htmlFor="booking-form-service">
          <select
            id="booking-form-service"
            data-testid="booking-form-service"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className={inputClass}
          >
            <option value="">Choose a service</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={`Date (${CLINIC_TZ})`} htmlFor="booking-form-date">
          <input
            id="booking-form-date"
            data-testid="booking-form-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <SlotList
        slots={slots}
        loaded={loaded}
        selected={selected}
        onSelect={setSelected}
        listTestId="booking-slots-list"
      />

      {selected ? (
        <p
          data-testid="booking-selected-slot"
          data-slot-start={selected}
          className="text-sm text-slate-700"
        >
          Selected: {clinicClockOf(new Date(selected))} clinic time
        </p>
      ) : null}

      <FormError testId="booking-form-error" message={error || slotsError} />

      <button
        type="submit"
        data-testid="booking-form-submit"
        disabled={busy}
        className={primaryButtonClass}
      >
        {busy ? "Booking…" : "Book appointment"}
      </button>
    </form>
  );
}
