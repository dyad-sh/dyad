import { BookingForm } from "@/components/booking-form";
import { Card, PageHeader } from "@/components/ui-bits";
import { listPractitioners, listServices } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function NewBookingPage() {
  const [practitioners, services] = await Promise.all([
    listPractitioners(),
    listServices(),
  ]);

  return (
    <div className="max-w-xl">
      <PageHeader title="New booking" />
      <Card className="p-6">
        <BookingForm
          practitioners={practitioners.map((p) => ({ id: p.id, name: p.name }))}
          services={services.map((s) => ({ id: s.id, name: s.name }))}
        />
      </Card>
    </div>
  );
}
