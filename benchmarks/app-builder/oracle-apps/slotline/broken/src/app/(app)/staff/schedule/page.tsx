import { Forbidden } from "@/components/forbidden";
import { StaffSchedule } from "@/components/staff-schedule";
import { PageHeader } from "@/components/ui-bits";
import { sessionUser } from "@/lib/auth/server";
import { isClinicDate } from "@/lib/clinic-time";
import { listPractitioners } from "@/lib/queries";
import { roleOf } from "@/lib/roles";
import { isUuid } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * `/staff/schedule?practitionerId=&date=YYYY-MM-DD` — staff only. The role is
 * checked on the server before anything is read, so a patient hitting this URL
 * directly never receives a name or an email.
 */
export default async function StaffSchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = (await sessionUser())!;
  const role = await roleOf(user.id);
  if (role !== "staff") {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Clinic schedule" />
        <Forbidden message="Only clinic staff can view a practitioner's day." />
      </div>
    );
  }

  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : (value ?? "");
  };
  const practitionerId = first("practitionerId");
  const date = first("date");
  const practitioners = await listPractitioners();

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Clinic schedule"
        subtitle="One practitioner's clinic day, soonest first."
      />
      <StaffSchedule
        practitioners={practitioners.map((p) => ({ id: p.id, name: p.name }))}
        initialPractitionerId={isUuid(practitionerId) ? practitionerId : ""}
        initialDate={isClinicDate(date) ? date : ""}
      />
    </div>
  );
}
