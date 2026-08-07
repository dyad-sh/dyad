"use client";

import { useState } from "react";
import { DeleteControl } from "@/components/delete-control";
import {
  PractitionerForm,
  type PractitionerFormValues,
} from "@/components/practitioner-form";
import { secondaryButtonClass } from "@/components/ui-bits";

/**
 * The practitioner detail card. Editing happens in place so the pinned detail
 * fields and the pinned form live on one URL.
 */
export function PractitionerDetailPanel({
  practitioner,
  canManage,
}: {
  practitioner: PractitionerFormValues;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-6">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Name
          </dt>
          <dd
            data-testid="practitioner-detail-name"
            className="mt-1 text-base font-medium text-slate-900"
          >
            {practitioner.name}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Specialty
          </dt>
          <dd
            data-testid="practitioner-detail-specialty"
            className="mt-1 text-base text-slate-700"
          >
            {practitioner.specialty}
          </dd>
        </div>
      </dl>

      {canManage ? (
        <div className="space-y-4 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="practitioner-edit-button"
              onClick={() => setEditing((v) => !v)}
              className={secondaryButtonClass}
            >
              {editing ? "Cancel edit" : "Edit"}
            </button>
            <DeleteControl
              endpoint={`/api/practitioners/${practitioner.id}`}
              redirectTo="/practitioners"
              buttonTestId="practitioner-delete-button"
              confirmTestId="practitioner-delete-confirm"
              label="Delete"
            />
          </div>
          {editing ? (
            <PractitionerForm
              practitioner={practitioner}
              onSaved={() => setEditing(false)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
