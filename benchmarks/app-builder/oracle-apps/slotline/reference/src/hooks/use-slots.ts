"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

export interface SlotOption {
  start: string;
  end: string;
}

/**
 * The offered slots for a practitioner, service and clinic-local date.
 *
 * The browser never computes a slot: it asks the server's generator and
 * renders the answer. The cancellation flag matters because the picker's three
 * inputs change in quick succession, and an older response must never overwrite
 * a newer one.
 */
export function useOfferedSlots(
  practitionerId: string,
  serviceId: string,
  date: string,
  /** A booking being moved does not block itself. */
  excludeBookingId?: string,
): { slots: SlotOption[]; loaded: boolean; error: string } {
  const [state, setState] = useState<{
    slots: SlotOption[];
    loaded: boolean;
    error: string;
  }>({ slots: [], loaded: false, error: "" });

  useEffect(() => {
    if (!practitionerId || !serviceId || !date) {
      setState({ slots: [], loaded: false, error: "" });
      return;
    }
    let cancelled = false;
    setState({ slots: [], loaded: false, error: "" });
    (async () => {
      const result = await apiFetch(
        `/api/slots?practitionerId=${encodeURIComponent(
          practitionerId,
        )}&serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(
          date,
        )}${
          excludeBookingId
            ? `&excludeBookingId=${encodeURIComponent(excludeBookingId)}`
            : ""
        }`,
      );
      if (cancelled) return;
      setState({
        slots: result.ok && Array.isArray(result.data) ? result.data : [],
        loaded: true,
        error: result.ok ? "" : result.error,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [practitionerId, serviceId, date, excludeBookingId]);

  return state;
}
