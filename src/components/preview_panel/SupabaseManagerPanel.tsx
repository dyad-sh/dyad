import { useState } from "react";
import {
  Database,
  HardDrive,
  Shield,
  Users,
  Key,
  FileText,
} from "lucide-react";
import { useRunApp } from "@/hooks/useRunApp";
import { cn } from "@/lib/utils";

// Section components
import { DatabaseSection } from "./sections/DatabaseSection";
import { StorageSection } from "./sections/StorageSection";
import { AuthSection } from "./sections/AuthSection";
import { UsersSection } from "./sections/UsersSection";
import { SecretsSection } from "./sections/SecretsSection";
import { LogsSection } from "./sections/LogsSection";

type ManagerSection =
  | "database"
  | "storage"
  | "auth"
  | "users"
  | "secrets"
  | "logs";

interface NavItemProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  section: ManagerSection;
  activeSection: ManagerSection;
  onSelect: (section: ManagerSection) => void;
}

function NavItem({
  icon: Icon,
  label,
  section,
  activeSection,
  onSelect,
}: NavItemProps) {
  const isActive = activeSection === section;

  return (
    <button
      type="button"
      onClick={() => onSelect(section)}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
        "hover:bg-accent/50",
        isActive && "bg-accent text-accent-foreground font-medium",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}

export function SupabaseManagerPanel() {
  const { app } = useRunApp();
  const projectId = app?.supabaseProjectId ?? null;
  const organizationSlug = app?.supabaseOrganizationSlug ?? null;

  const [activeSection, setActiveSection] =
    useState<ManagerSection>("database");

  // Not connected state
  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <Database className="w-12 h-12 text-muted-foreground" />
        <div>
          <h3 className="text-lg font-medium mb-2">No Database Connected</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Connect Supabase to view and manage your backend. Go to the
            Configure panel to link a Supabase project to this app.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left Sidebar */}
      <div className="w-48 border-r border-border bg-muted/30 flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">
            Manage your back-end
          </h2>
        </div>
        <nav className="flex-1 py-2">
          <NavItem
            icon={Database}
            label="Database"
            section="database"
            activeSection={activeSection}
            onSelect={setActiveSection}
          />
          <NavItem
            icon={HardDrive}
            label="Storage"
            section="storage"
            activeSection={activeSection}
            onSelect={setActiveSection}
          />
          <NavItem
            icon={Shield}
            label="Authentication"
            section="auth"
            activeSection={activeSection}
            onSelect={setActiveSection}
          />
          <NavItem
            icon={Users}
            label="Users"
            section="users"
            activeSection={activeSection}
            onSelect={setActiveSection}
          />
          <NavItem
            icon={Key}
            label="Secrets"
            section="secrets"
            activeSection={activeSection}
            onSelect={setActiveSection}
          />
          <NavItem
            icon={FileText}
            label="Logs"
            section="logs"
            activeSection={activeSection}
            onSelect={setActiveSection}
          />
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {activeSection === "database" && (
          <DatabaseSection
            projectId={projectId}
            organizationSlug={organizationSlug}
          />
        )}
        {activeSection === "storage" && <StorageSection />}
        {activeSection === "auth" && <AuthSection />}
        {activeSection === "users" && (
          <UsersSection
            projectId={projectId}
            organizationSlug={organizationSlug}
          />
        )}
        {activeSection === "secrets" && (
          <SecretsSection
            projectId={projectId}
            organizationSlug={organizationSlug}
          />
        )}
        {activeSection === "logs" && (
          <LogsSection
            projectId={projectId}
            organizationSlug={organizationSlug}
          />
        )}
      </div>
    </div>
  );
}
