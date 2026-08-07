import Link from "next/link";
import { notFound } from "next/navigation";
import { PractitionerDetailPanel } from "@/components/practitioner-detail-panel";
import { Card, PageHeader, secondaryButtonClass } from "@/components/ui-bits";
import { sessionUser } from "@/lib/auth/server";
import { getPractitioner, practitionerDto } from "@/lib/queries";
import { roleOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function PractitionerDetailPage({
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
  const isStaff = role === "staff";

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Practitioner"
        action={
          isStaff ? (
            <Link
              href={`/practitioners/${practitioner.id}/availability`}
              data-testid="nav-availability"
              className={secondaryButtonClass}
            >
              Weekly availability
            </Link>
          ) : undefined
        }
      />
      <Card className="p-6">
        <PractitionerDetailPanel
          practitioner={practitionerDto(practitioner)}
          canManage={isStaff}
        />
      </Card>
    </div>
  );
}
