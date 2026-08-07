"use client";

import { useState } from "react";
import { DeleteControl } from "@/components/delete-control";
import { ServiceForm, type ServiceFormValues } from "@/components/service-form";
import { secondaryButtonClass } from "@/components/ui-bits";

export function ServiceDetailPanel({
  service,
  canManage,
}: {
  service: ServiceFormValues;
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
          <dd className="mt-1 text-base font-medium text-slate-900">
            {service.name}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Duration
          </dt>
          <dd className="mt-1 text-base text-slate-700">
            {service.durationMinutes} min
          </dd>
        </div>
      </dl>

      {canManage ? (
        <div className="space-y-4 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="service-edit-button"
              onClick={() => setEditing((v) => !v)}
              className={secondaryButtonClass}
            >
              {editing ? "Cancel edit" : "Edit"}
            </button>
            <DeleteControl
              endpoint={`/api/services/${service.id}`}
              redirectTo="/services"
              buttonTestId="service-delete-button"
              confirmTestId="service-delete-confirm"
              label="Delete"
            />
          </div>
          {editing ? (
            <ServiceForm service={service} onSaved={() => setEditing(false)} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
