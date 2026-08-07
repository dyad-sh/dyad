import { Forbidden } from "@/components/forbidden";
import { PractitionerForm } from "@/components/practitioner-form";
import { Card, PageHeader } from "@/components/ui-bits";
import { sessionUser } from "@/lib/auth/server";
import { roleOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function NewPractitionerPage() {
  const user = (await sessionUser())!;
  const role = await roleOf(user.id);

  return (
    <div className="max-w-xl">
      <PageHeader title="New practitioner" />
      {role === "staff" ? (
        <Card className="p-6">
          <PractitionerForm />
        </Card>
      ) : (
        <Forbidden message="Only clinic staff can add practitioners." />
      )}
    </div>
  );
}
