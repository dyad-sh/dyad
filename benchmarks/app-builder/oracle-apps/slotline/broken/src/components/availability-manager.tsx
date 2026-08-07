"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { weekdayName } from "@/lib/clinic-time";
import {
  Card,
  Field,
  FormError,
  dangerButtonClass,
  inputClass,
  primaryButtonClass,
} from "@/components/ui-bits";
import type { AvailabilityDto } from "@/lib/types";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Weekly availability for one practitioner. Windows are authored in clinic
 * local time — a weekday plus two wall clocks — and never as instants.
 */
export function AvailabilityManager({
  practitionerId,
  windows,
}: {
  practitionerId: string;
  windows: AvailabilityDto[];
}) {
  const router = useRouter();
  const [weekday, setWeekday] = useState("1");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const result = await apiFetch(
      `/api/practitioners/${practitionerId}/availability`,
      { method: "POST", body: { weekday: Number(weekday), startTime, endTime } },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStartTime("");
    setEndTime("");
    router.refresh();
  }

  async function remove(id: string) {
    setError("");
    const result = await apiFetch(
      `/api/practitioners/${practitionerId}/availability/${id}`,
      { method: "DELETE" },
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <ul data-testid="availability-list" className="divide-y divide-slate-100">
          {windows.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-slate-500">
              This practitioner has no weekly availability yet.
            </li>
          ) : (
            windows.map((w) => (
              <li
                key={w.id}
                data-testid="availability-row"
                data-availability-id={w.id}
                data-weekday={w.weekday}
                data-start-time={w.startTime}
                data-end-time={w.endTime}
                className="flex flex-wrap items-center gap-3 px-5 py-4"
              >
                <span
                  data-testid="availability-row-weekday"
                  className="font-medium text-slate-900"
                >
                  {weekdayName(w.weekday)}
                </span>
                <span
                  data-testid="availability-row-hours"
                  className="text-sm text-slate-700"
                >
                  {w.startTime} – {w.endTime}
                </span>
                <button
                  type="button"
                  data-testid="availability-delete-button"
                  onClick={() => remove(w.id)}
                  className={`ml-auto ${dangerButtonClass}`}
                >
                  Remove
                </button>
              </li>
            ))
          )}
        </ul>
      </Card>

      <Card className="p-6">
        <form onSubmit={add} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Weekday" htmlFor="availability-weekday">
              <select
                id="availability-weekday"
                data-testid="availability-weekday"
                value={weekday}
                onChange={(e) => setWeekday(e.target.value)}
                className={inputClass}
              >
                {WEEKDAYS.map((d) => (
                  <option key={d} value={String(d)}>
                    {weekdayName(d)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Starts" htmlFor="availability-start-time">
              <input
                id="availability-start-time"
                data-testid="availability-start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Ends" htmlFor="availability-end-time">
              <input
                id="availability-end-time"
                data-testid="availability-end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <FormError testId="availability-error" message={error} />
          <button
            type="submit"
            data-testid="availability-submit"
            disabled={busy}
            className={primaryButtonClass}
          >
            {busy ? "Adding…" : "Add window"}
          </button>
        </form>
      </Card>
    </div>
  );
}
