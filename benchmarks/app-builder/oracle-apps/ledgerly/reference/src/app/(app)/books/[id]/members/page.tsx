import { notFound } from "next/navigation";
import { MemberAddForm } from "@/components/member-add-form";
import { isOwner, listMembers } from "@/lib/books";
import { pageBookContext } from "@/lib/context";
import { looksLikeId } from "@/lib/validate";

export const dynamic = "force-dynamic";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!looksLikeId(id)) notFound();

  // Membership is verified on the server; a book the caller does not belong to
  // is not confirmed to exist, let alone listed.
  const ctx = await pageBookContext(id);
  const members = await listMembers(ctx.bookId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Members of {ctx.bookName}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          A role is per book — it grants nothing in any other book.
        </p>
      </div>

      {isOwner(ctx.role) ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <MemberAddForm bookId={ctx.bookId} />
        </div>
      ) : null}

      <div
        data-testid="members-list"
        className="overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        <div className="grid grid-cols-[1fr_10rem] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Email</span>
          <span>Role</span>
        </div>
        {members.map((member) => (
          <div
            key={member.id}
            data-testid="member-row"
            data-user-id={member.userId}
            className="grid grid-cols-[1fr_10rem] gap-4 border-b border-slate-100 px-5 py-3 text-sm last:border-b-0"
          >
            <span data-testid="member-row-email" className="text-slate-900">
              {member.email}
            </span>
            <span data-testid="member-row-role" className="text-slate-600">
              {member.role}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
