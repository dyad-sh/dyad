"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  Field,
  FormError,
  dangerButtonClass,
  inputClass,
  secondaryButtonClass,
} from "@/components/ui-bits";
import { apiFetch } from "@/lib/api-client";
import { CLINIC_TZ, formatClinicRange } from "@/lib/clinic-time";
import type { PractitionerBookingDto } from "@/lib/types";

interface Option {
  id: string;
  name: string;
}

/**
 * One practitioner's clinic day, soonest first.
 *
 * The day is a *clinic* day: the server brackets it with the two instants that
 * bound that calendar date in clinic time, so an 18:00 appointment belongs to
 * the day it was booked on even though its UTC instant falls on the next date.
 */
export function StaffSchedule({
  practitioners,
  initialPractitionerId,
  initialDate,
}: {
  practitioners: Option[];
  initialPractitionerId: string;
  initialDate: string;
}) {
  const [practitionerId, setPractitionerId] = useState(initialPractitionerId);
  const [date, setDate] = useState(initialDate);
  const [rows, setRows] = useState<PractitionerBookingDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!practitionerId || !date) {
      setLoaded(false);
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    (async () => {
      const result = await apiFetch(
        `/api/practitioners/${practitionerId}/bookings?date=${encodeURIComponent(date)}`,
      );
      if (cancelled) return;
      setRows(result.ok && Array.isArray(result.data) ? result.data : []);
      setError(result.ok ? "" : result.error);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [practitionerId, date, reloadToken]);

  // Keep the pinned `?practitionerId=&date=` shape shareable without kicking
  // off a navigation that would re-run the fetch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (practitionerId) url.searchParams.set("practitionerId", practitionerId);
    else url.searchParams.delete("practitionerId");
    if (date) url.searchParams.set("date", date);
    else url.searchParams.delete("date");
    window.history.replaceState(null, "", url.toString());
  }, [practitionerId, date]);

  const act = useCallback(async (bookingId: string, action: string) => {
    setError("");
    const result = await apiFetch(`/api/bookings/${bookingId}/${action}`, {
      method: "POST",
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReloadToken((n) => n + 1);
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Practitioner" htmlFor="schedule-practitioner-select">
          <select
            id="schedule-practitioner-select"
            data-testid="schedule-practitioner-select"
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
        <Field label={`Day (${CLINIC_TZ})`} htmlFor="schedule-date-input">
          <input
            id="schedule-date-input"
            data-testid="schedule-date-input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <FormError testId="schedule-error" message={error} />

      {!loaded ? null : rows.length === 0 ? (
        <p
          data-testid="schedule-empty"
          className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500"
        >
          No appointments on that clinic day.
        </p>
      ) : (
        <Card>
          <ul data-testid="schedule-list" className="divide-y divide-slate-100">
            {rows.map((row) => (
              <li
                key={row.id}
                data-testid="schedule-row"
                data-booking-id={row.id}
                data-start={row.startAt}
                data-end={row.endAt}
                data-status={row.status}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
              >
                <span
                  data-testid="schedule-row-time"
                  className="w-28 font-medium text-slate-900"
                >
                  {formatClinicRange(row.startAt, row.endAt)}
                </span>
                <span data-testid="schedule-row-patient" className="text-sm text-slate-700">
                  {row.patientName} · {row.patientEmail}
                </span>
                <span data-testid="schedule-row-service" className="text-sm text-slate-600">
                  {row.serviceName}
                </span>
                <span
                  data-testid="schedule-row-status"
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    row.status === "booked"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {row.status}
                </span>
                {row.status === "booked" ? (
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="schedule-no-show-button"
                      onClick={() => act(row.id, "no-show")}
                      className={secondaryButtonClass}
                    >
                      No show
                    </button>
                    <button
                      type="button"
                      data-testid="schedule-complete-button"
                      onClick={() => act(row.id, "complete")}
                      className={secondaryButtonClass}
                    >
                      Completed
                    </button>
                    <button
                      type="button"
                      data-testid="schedule-cancel-button"
                      onClick={() => act(row.id, "cancel")}
                      className={dangerButtonClass}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span className="ml-auto text-xs text-slate-400">
                    Closed
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
