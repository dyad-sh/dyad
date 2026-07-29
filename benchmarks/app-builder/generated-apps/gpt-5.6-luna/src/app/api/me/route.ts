import { getTenantContext, tenantResponse } from '@/lib/tenant';
export const dynamic = 'force-dynamic';
export async function GET() { try { const { user, workspace, memberships } = await getTenantContext(); return Response.json({ id: user.id, email: user.email, name: user.name, activeWorkspaceId: workspace.id, memberships: memberships.map((m) => ({ workspaceId: m.workspaceId, workspaceName: m.workspaceName, membershipId: m.membershipId, role: m.role })) }); } catch (error) { return tenantResponse(error); } }
