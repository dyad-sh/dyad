import { Forbidden } from "@/components/forbidden";
import { ServiceForm } from "@/components/service-form";
import { Card, PageHeader } from "@/components/ui-bits";
import { sessionUser } from "@/lib/auth/server";
import { roleOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function NewServicePage() {
  const user = (await sessionUser())!;
  const role = await roleOf(user.id);

  return (
    <div className="max-w-xl">
      <PageHeader title="New service" />
      {role === "staff" ? (
        <Card className="p-6">
          <ServiceForm />
        </Card>
      ) : (
        <Forbidden message="Only clinic staff can add services." />
      )}
    </div>
  );
}
