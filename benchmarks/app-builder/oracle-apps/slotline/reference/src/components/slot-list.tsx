"use client";

import { clinicClockOf } from "@/lib/clinic-time";
import type { SlotOption } from "@/hooks/use-slots";

/**
 * The offered slots, rendered identically wherever they are picked (new
 * booking, reschedule). Times are shown in clinic time; the UTC instants ride
 * along in the pinned `data-*` attributes.
 *
 * Nothing renders until the server has answered: a "no slots" state that is
 * really "still loading" would tell the patient the day is full when it is not.
 */
export function SlotList({
  slots,
  loaded,
  selected,
  onSelect,
  listTestId,
}: {
  slots: SlotOption[];
  loaded: boolean;
  selected: string;
  onSelect: (start: string) => void;
  listTestId: string;
}) {
  if (!loaded) return null;

  if (slots.length === 0) {
    return (
      <p
        data-testid="slot-empty"
        className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500"
      >
        No times are available on that day.
      </p>
    );
  }

  return (
    <ul
      data-testid={listTestId}
      className="flex flex-wrap gap-2"
      aria-label="Available times"
    >
      {slots.map((slot) => {
        const isSelected = selected === slot.start;
        return (
          <li key={slot.start}>
            <button
              type="button"
              data-testid="slot-option"
              data-slot-start={slot.start}
              data-slot-end={slot.end}
              aria-pressed={isSelected}
              onClick={() => onSelect(slot.start)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                isSelected
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              {clinicClockOf(new Date(slot.start))}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
