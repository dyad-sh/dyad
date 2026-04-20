/**
 * User Profile & Account Page
 *
 * Profile management, account settings, connected services,
 * activity history, and usage statistics.
 *
 * Tabs:
 * 1. Profile — avatar, display name, bio, social links
 * 2. Account — email, password, 2FA, linked wallets
 * 3. Usage — token usage, API calls, storage, costs
 * 4. Connected — GitHub, Vercel, Supabase, wallets, email
 * 5. Activity — recent actions, login history
 * 6. Export — data export, account deletion
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  User, Mail, Lock, Shield, Key, Wallet, Github, Globe,
  Activity, Download, Trash2, Camera, Edit3, Save,
  BarChart3, Database, Cpu, Clock, Link, ExternalLink,
  CheckCircle2, XCircle, RefreshCw, Fingerprint,
} from "lucide-react";

// ============================================================================
// PROFILE TAB
// ============================================================================

function ProfileTab() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start gap-6">
        <div className="relative group">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white text-2xl font-bold">
            T
          </div>
          <Button size="sm" variant="outline" className="absolute -bottom-2 -right-2 h-7 w-7 p-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
            <Camera className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <Label className="text-xs">Display Name</Label>
            <Input defaultValue="Terry" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Bio</Label>
            <Textarea defaultValue="Builder and entrepreneur. Creating the future with AI." className="mt-1" rows={3} />
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Social Links</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">GitHub</Label>
            <Input placeholder="github.com/username" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Twitter/X</Label>
            <Input placeholder="x.com/username" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Website</Label>
            <Input placeholder="https://yoursite.com" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">ENS Name</Label>
            <Input placeholder="yourname.eth" className="mt-1" />
          </div>
        </div>
      </div>

      <Button className="gap-1.5"><Save className="w-4 h-4" /> Save Profile</Button>
    </div>
  );
}

// ============================================================================
// ACCOUNT TAB
// ============================================================================

function AccountTab() {
  return (
    <div className="space-y-6 max-w-2xl">
      <Card className="bg-muted/10 border-border/30">
        <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Email & Password</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div>
            <Label className="text-xs">Email</Label>
            <Input defaultValue="terry@joymarketplace.io" className="mt-1" />
          </div>
          <Button variant="outline" size="sm"><Lock className="w-3.5 h-3.5 mr-1" /> Change Password</Button>
        </CardContent>
      </Card>

      <Card className="bg-muted/10 border-border/30">
        <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Two-Factor Authentication</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground/60">Add an extra layer of security to your account</p>
            </div>
            <Button variant="outline" size="sm"><Shield className="w-3.5 h-3.5 mr-1" /> Enable 2FA</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted/10 border-border/30">
        <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Connected Wallets</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          <div className="flex items-center justify-between p-2 rounded-lg bg-muted/20">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-orange-400" />
              <span className="text-xs font-mono">0x1234...5678</span>
              <Badge className="bg-green-500 text-[9px]">Primary</Badge>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-[10px]">Disconnect</Button>
          </div>
          <Button variant="outline" size="sm" className="w-full"><Wallet className="w-3.5 h-3.5 mr-1" /> Connect Wallet</Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// USAGE TAB
// ============================================================================

function UsageTab() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Tokens Used (Month)", value: "1.2M", limit: "10M", pct: 12, color: "bg-blue-500" },
          { label: "API Calls (Month)", value: "3,847", limit: "50,000", pct: 8, color: "bg-green-500" },
          { label: "Storage Used", value: "2.1 GB", limit: "50 GB", pct: 4, color: "bg-purple-500" },
          { label: "Total Cost (Month)", value: "$12.50", limit: "$100", pct: 13, color: "bg-amber-500" },
        ].map((stat) => (
          <Card key={stat.label} className="bg-muted/20 border-border/40">
            <CardContent className="p-4">
              <span className="text-[11px] text-muted-foreground/60 block">{stat.label}</span>
              <span className="text-lg font-bold block">{stat.value}</span>
              <span className="text-[10px] text-muted-foreground/40">/ {stat.limit}</span>
              <Progress value={stat.pct} className="h-1.5 mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-muted/10 border-border/30">
        <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Usage by Category</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          {[
            { name: "Chat / Build", tokens: "650K", pct: 54 },
            { name: "Agent Operations", tokens: "280K", pct: 23 },
            { name: "Document AI", tokens: "120K", pct: 10 },
            { name: "Neural Builder", tokens: "90K", pct: 8 },
            { name: "Other", tokens: "60K", pct: 5 },
          ].map((cat) => (
            <div key={cat.name} className="flex items-center gap-3">
              <span className="text-xs w-32 truncate">{cat.name}</span>
              <Progress value={cat.pct} className="flex-1 h-2" />
              <span className="text-xs text-muted-foreground/60 w-16 text-right">{cat.tokens}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// CONNECTED SERVICES TAB
// ============================================================================

function ConnectedServicesTab() {
  const services = [
    { name: "GitHub", icon: <Github className="w-5 h-5" />, connected: true, account: "DisciplesofLove" },
    { name: "Vercel", icon: <Globe className="w-5 h-5" />, connected: false },
    { name: "Supabase", icon: <Database className="w-5 h-5" />, connected: false },
    { name: "IMAP Email", icon: <Mail className="w-5 h-5" />, connected: true, account: "hello@joymarketplace.io" },
    { name: "OpenClaw", icon: <Cpu className="w-5 h-5" />, connected: true, account: "Local Gateway" },
    { name: "Ollama", icon: <Cpu className="w-5 h-5" />, connected: true, account: "12+ models loaded" },
  ];

  return (
    <div className="space-y-3 max-w-2xl">
      {services.map((svc) => (
        <Card key={svc.name} className="bg-muted/10 border-border/30">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-muted/30 flex items-center justify-center">{svc.icon}</div>
            <div className="flex-1">
              <span className="text-sm font-medium">{svc.name}</span>
              {svc.account && <span className="text-[11px] text-muted-foreground/60 block">{svc.account}</span>}
            </div>
            {svc.connected ? (
              <Badge className="bg-green-500/20 text-green-400 text-[10px]"><CheckCircle2 className="w-3 h-3 mr-0.5" /> Connected</Badge>
            ) : (
              <Button variant="outline" size="sm" className="h-7 text-[10px]"><Link className="w-3 h-3 mr-0.5" /> Connect</Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// ACTIVITY TAB
// ============================================================================

function ActivityTab() {
  const recentActivity = [
    { action: "Built app 'DataVault Pro'", time: "2 hours ago", icon: <Cpu className="w-3.5 h-3.5" /> },
    { action: "Deployed CustomerCare Pro agent", time: "3 hours ago", icon: <Activity className="w-3.5 h-3.5" /> },
    { action: "Created marketplace listing", time: "5 hours ago", icon: <Globe className="w-3.5 h-3.5" /> },
    { action: "Updated identity: ENS linked", time: "1 day ago", icon: <Fingerprint className="w-3.5 h-3.5" /> },
    { action: "Published workflow template", time: "1 day ago", icon: <Activity className="w-3.5 h-3.5" /> },
    { action: "Committed to feat/library-celestia-ui", time: "1 day ago", icon: <Github className="w-3.5 h-3.5" /> },
    { action: "Fine-tuned model: code-assist-v2", time: "2 days ago", icon: <Cpu className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-2 max-w-2xl">
      {recentActivity.map((item, i) => (
        <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/10">
          <div className="w-8 h-8 rounded-lg bg-muted/20 flex items-center justify-center text-muted-foreground/60">{item.icon}</div>
          <span className="text-sm flex-1">{item.action}</span>
          <span className="text-[11px] text-muted-foreground/50">{item.time}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function UserProfilePage() {
  const [activeTab, setActiveTab] = useState("profile");

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center">
            <User className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Profile & Account</h1>
            <p className="text-sm text-muted-foreground">Manage your identity, connections, and usage</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="border-b px-4">
          <TabsList className="bg-transparent">
            <TabsTrigger value="profile" className="gap-1.5"><User className="w-3.5 h-3.5" /> Profile</TabsTrigger>
            <TabsTrigger value="account" className="gap-1.5"><Key className="w-3.5 h-3.5" /> Account</TabsTrigger>
            <TabsTrigger value="usage" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Usage</TabsTrigger>
            <TabsTrigger value="connected" className="gap-1.5"><Link className="w-3.5 h-3.5" /> Connected</TabsTrigger>
            <TabsTrigger value="activity" className="gap-1.5"><Activity className="w-3.5 h-3.5" /> Activity</TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4">
            <TabsContent value="profile" className="mt-0"><ProfileTab /></TabsContent>
            <TabsContent value="account" className="mt-0"><AccountTab /></TabsContent>
            <TabsContent value="usage" className="mt-0"><UsageTab /></TabsContent>
            <TabsContent value="connected" className="mt-0"><ConnectedServicesTab /></TabsContent>
            <TabsContent value="activity" className="mt-0"><ActivityTab /></TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
