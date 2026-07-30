"use server";

import { revalidatePath } from "next/cache";
import {
  createOrganization,
  getMembership,
  requireUser,
  updateOrganization,
} from "@/lib/orgs";
import { isOrgAdmin } from "@/lib/roles";

export async function createOrganizationAction(input: {
  name: string;
  slug: string;
}): Promise<{ orgId?: string; error?: string }> {
  const user = await requireUser();
  const result = await createOrganization({
    name: input.name,
    slug: input.slug,
    user,
  });

  if (result.error || !result.org) {
    return { error: result.error ?? "Failed to create organization." };
  }

  revalidatePath("/orgs");
  revalidatePath(`/orgs/${result.org.id}`);
  return { orgId: result.org.id };
}

export async function updateOrganizationAction(input: {
  orgId: string;
  name: string;
  description: string;
}): Promise<{ error?: string }> {
  const user = await requireUser();
  const membership = await getMembership(input.orgId, user.id);

  if (!membership) {
    return { error: "You are not a member of this organization." };
  }
  if (!isOrgAdmin(membership.role)) {
    return { error: "Only organization admins can edit settings." };
  }

  const result = await updateOrganization(
    input.orgId,
    {
      name: input.name,
      description: input.description,
    },
    user,
  );

  if (result.error) {
    return { error: result.error };
  }

  revalidatePath("/orgs");
  revalidatePath(`/orgs/${input.orgId}`);
  revalidatePath(`/orgs/${input.orgId}/settings`);
  revalidatePath(`/orgs/${input.orgId}/audit`);
  revalidatePath(`/orgs/${input.orgId}/usage`);
  return {};
}
