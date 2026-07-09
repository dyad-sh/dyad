import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { Activity, AlertTriangle, Bot, BookOpen, Briefcase, Building2, Gauge, Rocket, Settings, Users } from "lucide-react";
import { MadeWithDyad } from "@/components/made-with-dyad";
import { classNames } from "@/lib/format";

const navItems = [
  { to: "/", label: "Dashboard", icon: Gauge },
  { to: "/projects", label: "Projects", icon: Briefcase },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/incidents", label: "Incidents", icon: AlertTriangle },
  { to: "/deployments", label: "Deployments", icon: Rocket },
  { to: "/automations", label: "Automations", icon: Bot },
  { to: "/knowledge", label: "Knowledge", icon: BookOpen },
  { to: "/reports", label: "Reports", icon: Activity },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r bg-white lg:block">
        <div className="flex h-16 items-center gap-3 border-b px-6">
          <Building2 className="h-6 w-6 text-emerald-600" />
          <div>
            <p className="text-sm font-semibold">Northstar Ops</p>
            <p className="text-xs text-slate-500">Scaffold fixture</p>
          </div>
        </div>
        <nav className="space-y-1 p-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                classNames(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                  isActive ? "bg-emerald-50 text-emerald-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-h-screen lg:pl-72">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>
      <MadeWithDyad />
    </div>
  );
}
