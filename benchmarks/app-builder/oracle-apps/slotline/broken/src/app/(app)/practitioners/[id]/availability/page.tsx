import { notFound } from "next/navigation";
import { AvailabilityManager } from "@/components/availability-manager";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/ui-bits";
import { sessionUser } from "@/lib/auth/server";
import {
  availabilityDto,
  getPractitioner,
  listAvailability,
} from "@/lib/queries";
import { roleOf } from "@/lib/roles";
import { CLINIC_TZ } from "@/lib/clinic-time";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = (await sessionUser())!;
  const [role, practitioner] = await Promise.all([
    roleOf(user.id),
    getPractitioner(id),
  ]);
  if (!practitioner) notFound();

  if (role !== "staff") {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Weekly availability" />
        <Forbidden message="Only clinic staff can manage availability." />
      </div>
    );
  }

  const windows = (await listAvailability(id)).map(availabilityDto);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={`Weekly availability · ${practitioner.name}`}
        subtitle={`Windows repeat every week and are written in ${CLINIC_TZ} local time.`}
      />
      <AvailabilityManager practitionerId={id} windows={windows} />
    </div>
  );
}
