import { notFound } from "next/navigation";
import { ServiceDetailPanel } from "@/components/service-detail-panel";
import { Card, PageHeader } from "@/components/ui-bits";
import { sessionUser } from "@/lib/auth/server";
import { getService, serviceDto } from "@/lib/queries";
import { roleOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = (await sessionUser())!;
  const [role, service] = await Promise.all([roleOf(user.id), getService(id)]);
  if (!service) notFound();

  return (
    <div className="max-w-2xl">
      <PageHeader title="Service" />
      <Card className="p-6">
        <ServiceDetailPanel
          service={serviceDto(service)}
          canManage={role === "staff"}
        />
      </Card>
    </div>
  );
}
