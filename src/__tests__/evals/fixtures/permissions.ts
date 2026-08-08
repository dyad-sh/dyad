// permissions.ts — role-based access control policies

interface Policy {
  canViewContent(): boolean;
  canCreateContent(): boolean;
  canEditContent(): boolean;
  canDeleteContent(): boolean;
  canViewUsers(): boolean;
  canManageUsers(): boolean;
  canViewRoles(): boolean;
  canManageRoles(): boolean;
  canViewAuditLog(): boolean;
  canExportData(): boolean;
}

export class AdminPolicy implements Policy {
  canViewContent(): boolean {
    return true;
  }

  canCreateContent(): boolean {
    return true;
  }

  canEditContent(): boolean {
    return true;
  }

  canDeleteContent(): boolean {
    return true;
  }

  canViewUsers(): boolean {
    return true;
  }

  canManageUsers(): boolean {
    return true;
  }

  canViewRoles(): boolean {
    return true;
  }

  canManageRoles(): boolean {
    return true;
  }

  canViewAuditLog(): boolean {
    return true;
  }

  canExportData(): boolean {
    return true;
  }
}

export class ModeratorPolicy implements Policy {
  canViewContent(): boolean {
    return true;
  }

  canCreateContent(): boolean {
    return true;
  }

  canEditContent(): boolean {
    return true;
  }

  canDeleteContent(): boolean {
    return true;
  }

  canViewUsers(): boolean {
    return true;
  }

  canManageUsers(): boolean {
    return true;
  }

  canViewRoles(): boolean {
    return true;
  }

  canManageRoles(): boolean {
    return false;
  }

  canViewAuditLog(): boolean {
    return true;
  }

  canExportData(): boolean {
    return true;
  }
}

export function createPolicy(role: string): Policy {
  switch (role) {
    case "admin":
      return new AdminPolicy();
    case "moderator":
      return new ModeratorPolicy();
    default:
      throw new Error(`Unknown role: ${role}`);
  }
}

export function hasPermission(policy: Policy, action: string): boolean {
  switch (action) {
    case "view_content":
      return policy.canViewContent();
    case "create_content":
      return policy.canCreateContent();
    case "edit_content":
      return policy.canEditContent();
    case "delete_content":
      return policy.canDeleteContent();
    case "view_users":
      return policy.canViewUsers();
    case "manage_users":
      return policy.canManageUsers();
    case "view_roles":
      return policy.canViewRoles();
    case "manage_roles":
      return policy.canManageRoles();
    case "view_audit_log":
      return policy.canViewAuditLog();
    case "export_data":
      return policy.canExportData();
    default:
      return false;
  }
}
