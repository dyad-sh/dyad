import { StaffJoinForm } from "@/components/staff-join-form";
import { Card, PageHeader } from "@/components/ui-bits";
import { sessionUser } from "@/lib/auth/server";
import { roleOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * Deliberately patient-accessible: submitting the code is how a patient becomes
 * staff, so gating this page behind the staff role would make the role
 * unreachable.
 */
export default async function StaffJoinPage() {
  const user = (await sessionUser())!;
  const role = await roleOf(user.id);

  return (
    <div className="max-w-lg">
      <PageHeader
        title="Staff access"
        subtitle="Clinic staff manage practitioners, services and availability."
      />
      <Card className="p-6">
        {role === "staff" ? (
          <p className="text-sm text-slate-600">
            You already have clinic staff access.
          </p>
        ) : (
          <StaffJoinForm />
        )}
      </Card>
    </div>
  );
}
