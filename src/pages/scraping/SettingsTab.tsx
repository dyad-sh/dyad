import {
  Shield,
  AlertTriangle,
  Trash2,
  Cookie,
  Fingerprint,
  Bot,
  Gauge,
  Upload,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useScrapingSessions, useDeleteSession } from "@/hooks/use_scraping";
import { fadeUpVariant, staggerItem } from "./constants";

export function SettingsTab() {
  const { data: sessions = [] } = useScrapingSessions();
  const deleteSession = useDeleteSession();

  return (
    <motion.div {...fadeUpVariant} className="space-y-6">
      {/* Auth Sessions */}
      <Card className="overflow-hidden border-border/50 shadow-sm">
        <div className="h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" />
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/20">
                <Shield className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Auth Sessions</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Saved browser sessions for authenticated scraping
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/5"
            >
              <Upload className="h-3.5 w-3.5" />
              Import Cookies
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <AnimatePresence initial={false}>
            {sessions.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-10 text-muted-foreground"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/5 border border-emerald-500/10 mb-3">
                  <Cookie className="h-6 w-6 text-emerald-500/30" />
                </div>
                <p className="font-medium text-foreground/60">No saved sessions</p>
                <p className="text-sm mt-1">Capture or import browser sessions to scrape authenticated pages</p>
              </motion.div>
            ) : (
              <div className="space-y-2">
                {sessions.map((s: any) => (
                  <motion.div key={s.id} {...staggerItem} layout>
                    <div className="group flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 p-3.5 transition-all duration-200 hover:border-emerald-500/20 hover:bg-muted/40">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/10">
                          <Fingerprint className="h-4 w-4 text-emerald-500/70" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{s.name}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            <span>{s.domain}</span>
                            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                              {s.cookies?.length ?? 0} cookies
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteSession.mutate(s.id)}
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Guardrails */}
      <Card className="overflow-hidden border-border/50 shadow-sm">
        <div className="h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500" />
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/20">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <CardTitle className="text-lg">Guardrails</CardTitle>
              <p className="text-sm text-muted-foreground">
                Safety and compliance settings
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          <GuardrailRow
            icon={<Fingerprint className="h-4 w-4 text-rose-500" />}
            title="PII Detection"
            description="Scan extracted data for personal information"
            defaultChecked
          />
          <Separator className="opacity-30" />
          <GuardrailRow
            icon={<Bot className="h-4 w-4 text-blue-500" />}
            title="Respect robots.txt"
            description="Honor site crawling restrictions"
            defaultChecked
          />
          <Separator className="opacity-30" />
          <GuardrailRow
            icon={<Gauge className="h-4 w-4 text-amber-500" />}
            title="Rate Limiting"
            description="Automatic polite delays between requests"
            defaultChecked
          />
        </CardContent>
      </Card>
    </motion.div>
  );
}

function GuardrailRow({
  icon,
  title,
  description,
  defaultChecked,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  defaultChecked?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg p-3 -mx-2 transition-colors hover:bg-muted/50">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/60">{icon}</div>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch defaultChecked={defaultChecked} />
    </div>
  );
}
