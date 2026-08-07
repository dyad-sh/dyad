import { notFound } from "next/navigation";
import { RescheduleForm } from "@/components/reschedule-form";
import { Forbidden } from "@/components/forbidden";
import { Card, PageHeader } from "@/components/ui-bits";
import { loadActionableBooking } from "@/lib/booking-service";
import { sessionUser } from "@/lib/auth/server";
import { formatClinicDateTime } from "@/lib/clinic-time";
import { patientMayChange } from "@/lib/policy";
import { roleOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ReschedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = (await sessionUser())!;
  const role = await roleOf(user.id);
  const booking = await loadActionableBooking({ user, role }, id);
  if (!booking) notFound();

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Reschedule"
        subtitle={`${booking.practitioner_name} · ${booking.service_name} · currently ${formatClinicDateTime(booking.start_at)}`}
      />
      {patientMayChange(booking, role) ? (
        <Card className="p-6">
          <RescheduleForm
            bookingId={booking.id}
            practitionerId={booking.practitioner_id}
            serviceId={booking.service_id}
          />
        </Card>
      ) : (
        <Forbidden message="This booking can no longer be rescheduled." />
      )}
    </div>
  );
}
