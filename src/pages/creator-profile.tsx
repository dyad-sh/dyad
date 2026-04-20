/**
 * Creator Profile — Public-facing profile for creators
 *
 * Shows a creator's published agents, apps, templates,
 * reputation, and social proof. Can be shared as a link.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import {
  User, Bot, Rocket, Package, Star, Globe, Github,
  ExternalLink, Heart, Download, Eye, Code2, Award,
  Calendar, MapPin, Link as LinkIcon,
} from "lucide-react";

export default function CreatorProfilePage() {
  const [activeTab, setActiveTab] = useState("agents");

  const stats = [
    { label: "Published Agents", value: "14", icon: <Bot className="w-4 h-4 text-violet-400" /> },
    { label: "Apps Built", value: "44", icon: <Rocket className="w-4 h-4 text-green-400" /> },
    { label: "Downloads", value: "12.4K", icon: <Download className="w-4 h-4 text-blue-400" /> },
    { label: "Avg Rating", value: "4.7★", icon: <Star className="w-4 h-4 text-amber-400" /> },
  ];

  const agents = [
    { name: "CustomerCare Pro", downloads: 4820, rating: 4.8, type: "chatbot" },
    { name: "Code Review Bot", downloads: 3100, rating: 4.6, type: "task" },
    { name: "Content Writer", downloads: 2340, rating: 4.5, type: "chatbot" },
    { name: "Data Analyst", downloads: 1200, rating: 4.7, type: "rag" },
  ];

  const apps = [
    { name: "ProAccountant Dashboard", views: 8900, installs: 1230 },
    { name: "AI3 Marketplace", views: 7200, installs: 980 },
    { name: "DataVault Pro", views: 5400, installs: 670 },
    { name: "Great Commission Hub", views: 3100, installs: 410 },
  ];

  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-1">
        {/* Profile Header */}
        <div className="bg-gradient-to-br from-violet-500/20 via-purple-500/10 to-pink-500/20 border-b p-8">
          <div className="max-w-4xl mx-auto flex items-start gap-6">
            <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white text-3xl font-bold shadow-lg">
              T
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">Terry</h1>
              <p className="text-sm text-muted-foreground mt-1">Builder and entrepreneur. Creating the future with AI and sovereign technology.</p>
              <div className="flex items-center gap-4 mt-3">
                <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1"><Calendar className="w-3 h-3" /> Joined Apr 2026</span>
                <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1"><MapPin className="w-3 h-3" /> East Coast, USA</span>
                <a className="text-[11px] text-blue-400 flex items-center gap-1 hover:underline"><Github className="w-3 h-3" /> DisciplesofLove</a>
                <a className="text-[11px] text-blue-400 flex items-center gap-1 hover:underline"><Globe className="w-3 h-3" /> joymarketplace.io</a>
              </div>
              <div className="flex items-center gap-2 mt-3">
                {[
                  { label: "AI Pioneer", color: "bg-violet-500/20 text-violet-400" },
                  { label: "Top Creator", color: "bg-amber-500/20 text-amber-400" },
                  { label: "100+ Downloads", color: "bg-green-500/20 text-green-400" },
                ].map(badge => (
                  <Badge key={badge.label} className={`${badge.color} text-[9px]`}><Award className="w-2.5 h-2.5 mr-0.5" />{badge.label}</Badge>
                ))}
              </div>
            </div>
            <Button variant="outline"><Heart className="w-4 h-4 mr-1" /> Follow</Button>
          </div>
        </div>

        {/* Stats */}
        <div className="max-w-4xl mx-auto px-8 -mt-6">
          <div className="grid grid-cols-4 gap-3">
            {stats.map(stat => (
              <Card key={stat.label} className="bg-background border-border/40 shadow-sm">
                <CardContent className="p-3 text-center">
                  <div className="mx-auto mb-1">{stat.icon}</div>
                  <span className="text-lg font-bold block">{stat.value}</span>
                  <span className="text-[10px] text-muted-foreground/50">{stat.label}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Content Tabs */}
        <div className="max-w-4xl mx-auto px-8 mt-6 pb-8">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-transparent">
              <TabsTrigger value="agents" className="gap-1.5"><Bot className="w-3.5 h-3.5" /> Agents</TabsTrigger>
              <TabsTrigger value="apps" className="gap-1.5"><Rocket className="w-3.5 h-3.5" /> Apps</TabsTrigger>
              <TabsTrigger value="templates" className="gap-1.5"><Package className="w-3.5 h-3.5" /> Templates</TabsTrigger>
            </TabsList>

            <TabsContent value="agents" className="mt-4 space-y-2">
              {agents.map(agent => (
                <Card key={agent.name} className="bg-muted/10 border-border/30">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center"><Bot className="w-5 h-5 text-violet-400" /></div>
                    <div className="flex-1">
                      <span className="text-sm font-medium">{agent.name}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[9px] capitalize">{agent.type}</Badge>
                        <span className="text-[10px] text-amber-400">★ {agent.rating}</span>
                        <span className="text-[10px] text-muted-foreground/40">{agent.downloads.toLocaleString()} downloads</span>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 text-[10px]"><Download className="w-3 h-3 mr-0.5" /> Install</Button>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="apps" className="mt-4 space-y-2">
              {apps.map(app => (
                <Card key={app.name} className="bg-muted/10 border-border/30">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center"><Rocket className="w-5 h-5 text-green-400" /></div>
                    <div className="flex-1">
                      <span className="text-sm font-medium">{app.name}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground/50"><Eye className="w-3 h-3 inline mr-0.5" />{app.views.toLocaleString()} views</span>
                        <span className="text-[10px] text-muted-foreground/50"><Download className="w-3 h-3 inline mr-0.5" />{app.installs.toLocaleString()} installs</span>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 text-[10px]"><ExternalLink className="w-3 h-3 mr-0.5" /> View</Button>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="templates" className="mt-4">
              <div className="text-center py-8 text-muted-foreground/40">
                <Package className="w-10 h-10 mx-auto mb-2" />
                <p className="text-sm">Templates coming soon</p>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}
