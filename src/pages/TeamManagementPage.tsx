/**
 * Team Management Page — Multi-user collaboration
 *
 * Manage team members, roles, permissions, invitations,
 * and shared resources across the JoyCreate workspace.
 *
 * Tabs:
 * 1. Members — list, invite, manage roles
 * 2. Roles — define custom roles and permissions
 * 3. Invitations — pending invites, bulk invite
 * 4. Activity — team activity feed
 * 5. Settings — workspace settings, SSO, domain verification
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Users, UserPlus, Shield, Crown, Settings, Mail,
  Activity, Search, MoreVertical, Eye, Edit3, Trash2,
  CheckCircle2, Clock, XCircle, Key, Lock, Globe, Building,
} from "lucide-react";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "developer" | "viewer";
  status: "active" | "invited" | "suspended";
  avatar: string;
  lastActive: string;
  agentsCreated: number;
  appsBuilt: number;
}

const MOCK_MEMBERS: TeamMember[] = [
  { id: "1", name: "Terry", email: "terry@joymarketplace.io", role: "owner", status: "active", avatar: "T", lastActive: new Date().toISOString(), agentsCreated: 14, appsBuilt: 44 },
  { id: "2", name: "LoveAssistant", email: "ai@openclaw.local", role: "admin", status: "active", avatar: "💕", lastActive: new Date().toISOString(), agentsCreated: 8, appsBuilt: 30 },
  { id: "3", name: "Alex Chen", email: "alex@example.com", role: "developer", status: "invited", avatar: "A", lastActive: "", agentsCreated: 0, appsBuilt: 0 },
  { id: "4", name: "Jordan Rivera", email: "jordan@example.com", role: "viewer", status: "active", avatar: "J", lastActive: new Date(Date.now() - 172800000).toISOString(), agentsCreated: 0, appsBuilt: 2 },
];

const ROLE_CONFIG = {
  owner: { label: "Owner", color: "text-amber-400", bg: "bg-amber-500/20", icon: <Crown className="w-3 h-3" /> },
  admin: { label: "Admin", color: "text-red-400", bg: "bg-red-500/20", icon: <Shield className="w-3 h-3" /> },
  developer: { label: "Developer", color: "text-blue-400", bg: "bg-blue-500/20", icon: <Edit3 className="w-3 h-3" /> },
  viewer: { label: "Viewer", color: "text-gray-400", bg: "bg-gray-500/20", icon: <Eye className="w-3 h-3" /> },
};

function MembersTab() {
  const [search, setSearch] = useState("");
  const filtered = MOCK_MEMBERS.filter(m => !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <Input placeholder="Search members..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 h-8 text-xs" />
        </div>
        <Button size="sm"><UserPlus className="w-3.5 h-3.5 mr-1" /> Invite</Button>
      </div>

      {filtered.map(member => {
        const role = ROLE_CONFIG[member.role];
        return (
          <Card key={member.id} className="bg-muted/10 border-border/30">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
                {member.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{member.name}</span>
                  <Badge className={`${role.bg} ${role.color} text-[9px]`}>{role.icon}<span className="ml-0.5">{role.label}</span></Badge>
                  {member.status === "invited" && <Badge className="bg-amber-500/20 text-amber-400 text-[9px]"><Clock className="w-2.5 h-2.5 mr-0.5" /> Invited</Badge>}
                  {member.status === "suspended" && <Badge className="bg-red-500/20 text-red-400 text-[9px]"><XCircle className="w-2.5 h-2.5 mr-0.5" /> Suspended</Badge>}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[10px] text-muted-foreground/50">{member.email}</span>
                  {member.lastActive && <span className="text-[10px] text-muted-foreground/40">{member.agentsCreated} agents • {member.appsBuilt} apps</span>}
                </div>
              </div>
              <Select defaultValue={member.role}>
                <SelectTrigger className="w-[110px] h-7 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="developer">Developer</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function RolesTab() {
  const permissions = ["Create Agents", "Deploy Apps", "Manage Team", "Access Marketplace", "View Analytics", "Edit Settings", "Manage Billing", "Access Secrets"];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 px-3 font-medium">Permission</th>
              <th className="text-center py-2 px-3 font-medium text-amber-400">Owner</th>
              <th className="text-center py-2 px-3 font-medium text-red-400">Admin</th>
              <th className="text-center py-2 px-3 font-medium text-blue-400">Developer</th>
              <th className="text-center py-2 px-3 font-medium text-gray-400">Viewer</th>
            </tr>
          </thead>
          <tbody>
            {permissions.map((perm, i) => {
              const checks = [
                [true, true, true, true],     // Create Agents
                [true, true, true, false],     // Deploy Apps
                [true, true, false, false],    // Manage Team
                [true, true, true, true],      // Access Marketplace
                [true, true, true, true],      // View Analytics
                [true, true, false, false],    // Edit Settings
                [true, false, false, false],   // Manage Billing
                [true, true, false, false],    // Access Secrets
              ][i];
              return (
                <tr key={perm} className="border-b border-border/20 hover:bg-muted/10">
                  <td className="py-2 px-3">{perm}</td>
                  {checks.map((check, j) => (
                    <td key={j} className="text-center py-2 px-3">
                      {check ? <CheckCircle2 className="w-4 h-4 text-green-400 mx-auto" /> : <XCircle className="w-4 h-4 text-muted-foreground/20 mx-auto" />}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button variant="outline" size="sm"><Shield className="w-3.5 h-3.5 mr-1" /> Create Custom Role</Button>
    </div>
  );
}

function TeamActivityTab() {
  const activities = [
    { actor: "Terry", action: "deployed CustomerCare Pro agent", time: "2h ago" },
    { actor: "LoveAssistant", action: "built 5 new pages (P1 audit fix)", time: "3h ago" },
    { actor: "Terry", action: "updated sidebar with 17 hidden pages", time: "3h ago" },
    { actor: "LoveAssistant", action: "enhanced Agent Swarm Command Center", time: "5h ago" },
    { actor: "Jordan Rivera", action: "viewed Analytics Dashboard", time: "2d ago" },
    { actor: "Terry", action: "invited Alex Chen as developer", time: "3d ago" },
  ];

  return (
    <div className="space-y-1">
      {activities.map((act, i) => (
        <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/10">
          <div className="w-8 h-8 rounded-lg bg-muted/20 flex items-center justify-center text-xs font-bold">{act.actor[0]}</div>
          <div className="flex-1">
            <span className="text-xs"><strong>{act.actor}</strong> {act.action}</span>
          </div>
          <span className="text-[10px] text-muted-foreground/50">{act.time}</span>
        </div>
      ))}
    </div>
  );
}

export default function TeamManagementPage() {
  const [activeTab, setActiveTab] = useState("members");

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Team</h1>
              <p className="text-sm text-muted-foreground">{MOCK_MEMBERS.filter(m => m.status === "active").length} active members</p>
            </div>
          </div>
          <Button size="sm"><UserPlus className="w-3.5 h-3.5 mr-1" /> Invite Member</Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="border-b px-4">
          <TabsList className="bg-transparent">
            <TabsTrigger value="members" className="gap-1.5"><Users className="w-3.5 h-3.5" /> Members</TabsTrigger>
            <TabsTrigger value="roles" className="gap-1.5"><Shield className="w-3.5 h-3.5" /> Roles</TabsTrigger>
            <TabsTrigger value="activity" className="gap-1.5"><Activity className="w-3.5 h-3.5" /> Activity</TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="flex-1 p-4">
          <TabsContent value="members" className="mt-0"><MembersTab /></TabsContent>
          <TabsContent value="roles" className="mt-0"><RolesTab /></TabsContent>
          <TabsContent value="activity" className="mt-0"><TeamActivityTab /></TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
