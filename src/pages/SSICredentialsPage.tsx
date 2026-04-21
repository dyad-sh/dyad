/**
 * SSI Credentials Page — Self-Sovereign Identity credential management
 *
 * Tabs:
 * 1. My Credentials — issued VCs, status, verification
 * 2. Issue — create and issue credentials
 * 3. Verify — verify incoming credentials
 * 4. Schemas — manage credential schemas
 * 5. Connections — DID connections and trust
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Fingerprint, Shield, CheckCircle2, XCircle, Key, FileText,
  Plus, Search, Download, Upload, RefreshCw, Eye, Lock,
  Link, Users, Globe, Clock, AlertTriangle, Stamp,
} from "lucide-react";

interface Credential {
  id: string;
  type: string;
  issuer: string;
  subject: string;
  status: "active" | "revoked" | "expired";
  issuedAt: string;
  expiresAt?: string;
  schemaName: string;
}

const MOCK_CREDENTIALS: Credential[] = [
  { id: "vc-1", type: "PlatformDeveloper", issuer: "did:joy:zQ3sh...kX7v", subject: "did:key:zDn...terry", status: "active", issuedAt: new Date(Date.now() - 2592000000).toISOString(), expiresAt: new Date(Date.now() + 31536000000).toISOString(), schemaName: "JoyCreate Developer Credential" },
  { id: "vc-2", type: "AgentCreator", issuer: "did:joy:zQ3sh...kX7v", subject: "did:key:zDn...terry", status: "active", issuedAt: new Date(Date.now() - 1296000000).toISOString(), schemaName: "Agent Creator Badge" },
  { id: "vc-3", type: "MarketplaceSeller", issuer: "did:joy:community", subject: "did:key:zDn...terry", status: "active", issuedAt: new Date(Date.now() - 604800000).toISOString(), schemaName: "Marketplace Verified Seller" },
  { id: "vc-4", type: "SecurityAudit", issuer: "did:key:zDn...auditor", subject: "did:joy:zQ3sh...kX7v", status: "expired", issuedAt: new Date(Date.now() - 7776000000).toISOString(), expiresAt: new Date(Date.now() - 2592000000).toISOString(), schemaName: "Security Audit Passed" },
];

const STATUS_CONFIG = {
  active: { label: "Active", color: "bg-green-500/20 text-green-400", icon: <CheckCircle2 className="w-3 h-3" /> },
  revoked: { label: "Revoked", color: "bg-red-500/20 text-red-400", icon: <XCircle className="w-3 h-3" /> },
  expired: { label: "Expired", color: "bg-amber-500/20 text-amber-400", icon: <Clock className="w-3 h-3" /> },
};

function MyCredentialsTab() {
  return (
    <div className="space-y-2">
      {MOCK_CREDENTIALS.map(cred => {
        const status = STATUS_CONFIG[cred.status];
        return (
          <Card key={cred.id} className="bg-muted/10 border-border/30">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
                <Stamp className="w-5 h-5 text-violet-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{cred.schemaName}</span>
                  <Badge className={`${status.color} text-[9px]`}>{status.icon}<span className="ml-0.5">{status.label}</span></Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-muted-foreground/50">Type: {cred.type}</span>
                  <span className="text-[10px] text-muted-foreground/40">Issued: {new Date(cred.issuedAt).toLocaleDateString()}</span>
                  {cred.expiresAt && <span className="text-[10px] text-muted-foreground/40">Expires: {new Date(cred.expiresAt).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" className="h-7 text-[10px]"><Eye className="w-3 h-3 mr-0.5" /> View</Button>
                <Button variant="ghost" size="sm" className="h-7 text-[10px]"><Download className="w-3 h-3 mr-0.5" /> Export</Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function IssueCredentialTab() {
  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="bg-muted/10 border-border/30">
        <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Issue New Credential</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div>
            <Label className="text-xs">Schema</Label>
            <Select defaultValue="developer">
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="developer">JoyCreate Developer</SelectItem>
                <SelectItem value="agent-creator">Agent Creator Badge</SelectItem>
                <SelectItem value="seller">Marketplace Verified Seller</SelectItem>
                <SelectItem value="security">Security Audit Passed</SelectItem>
                <SelectItem value="custom">Custom Schema...</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Subject DID</Label>
            <Input placeholder="did:key:z6Mk..." className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Claims (JSON)</Label>
            <Textarea placeholder='{"name": "Terry", "level": "expert", "skills": ["agents", "apps"]}' className="mt-1 font-mono text-xs" rows={4} />
          </div>
          <div>
            <Label className="text-xs">Expiration (optional)</Label>
            <Input type="date" className="mt-1" />
          </div>
          <Button onClick={() => toast.success("Credential issued!")}><Stamp className="w-4 h-4 mr-1" /> Issue Credential</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function VerifyCredentialTab() {
  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="bg-muted/10 border-border/30">
        <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Verify a Credential</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div>
            <Label className="text-xs">Paste Verifiable Credential (JWT or JSON-LD)</Label>
            <Textarea placeholder='{"@context": ["https://www.w3.org/2018/credentials/v1"], "type": ["VerifiableCredential"], ...}' className="mt-1 font-mono text-xs" rows={8} />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => toast.success("Credential verified ✅")}><Shield className="w-4 h-4 mr-1" /> Verify</Button>
            <Button variant="outline"><Upload className="w-4 h-4 mr-1" /> Upload File</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SchemasTab() {
  const schemas = [
    { name: "JoyCreate Developer", fields: 5, credentials: 12, version: "1.0" },
    { name: "Agent Creator Badge", fields: 3, credentials: 8, version: "1.0" },
    { name: "Marketplace Verified Seller", fields: 4, credentials: 23, version: "1.1" },
    { name: "Security Audit Passed", fields: 6, credentials: 5, version: "2.0" },
    { name: "Compute Node Operator", fields: 7, credentials: 3, version: "1.0" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <Input placeholder="Search schemas..." className="pl-10 h-8 text-xs" />
        </div>
        <Button size="sm"><Plus className="w-3.5 h-3.5 mr-1" /> Create Schema</Button>
      </div>
      {schemas.map(schema => (
        <Card key={schema.name} className="bg-muted/10 border-border/30">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-400" />
            </div>
            <div className="flex-1">
              <span className="text-sm font-medium">{schema.name}</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-muted-foreground/50">{schema.fields} fields</span>
                <span className="text-[10px] text-muted-foreground/50">{schema.credentials} issued</span>
                <Badge variant="outline" className="text-[9px]">v{schema.version}</Badge>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-[10px]"><Eye className="w-3 h-3 mr-0.5" /> View</Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function SSICredentialsPage() {
  const [activeTab, setActiveTab] = useState("credentials");

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
            <Fingerprint className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">SSI Credentials</h1>
            <p className="text-sm text-muted-foreground">Self-Sovereign Identity — issue, hold, verify</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="border-b px-4">
          <TabsList className="bg-transparent">
            <TabsTrigger value="credentials" className="gap-1.5"><Key className="w-3.5 h-3.5" /> My Credentials</TabsTrigger>
            <TabsTrigger value="issue" className="gap-1.5"><Stamp className="w-3.5 h-3.5" /> Issue</TabsTrigger>
            <TabsTrigger value="verify" className="gap-1.5"><Shield className="w-3.5 h-3.5" /> Verify</TabsTrigger>
            <TabsTrigger value="schemas" className="gap-1.5"><FileText className="w-3.5 h-3.5" /> Schemas</TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="flex-1 p-4">
          <TabsContent value="credentials" className="mt-0"><MyCredentialsTab /></TabsContent>
          <TabsContent value="issue" className="mt-0"><IssueCredentialTab /></TabsContent>
          <TabsContent value="verify" className="mt-0"><VerifyCredentialTab /></TabsContent>
          <TabsContent value="schemas" className="mt-0"><SchemasTab /></TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
