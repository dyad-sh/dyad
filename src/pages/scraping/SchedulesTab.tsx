import { useState } from "react";
import { Clock, Plus, Trash2, Loader2, CalendarClock, Timer } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { showError, showSuccess } from "@/lib/toast";
import {
  useScrapingSchedules,
  useCreateSchedule,
  useDeleteSchedule,
  useToggleSchedule,
} from "@/hooks/use_scraping";
import { fadeUpVariant, staggerItem } from "./constants";

export function SchedulesTab() {
  const { data: schedules = [] } = useScrapingSchedules();
  const createSchedule = useCreateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const toggleSchedule = useToggleSchedule();

  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 */6 * * *");

  return (
    <motion.div {...fadeUpVariant} className="space-y-6">
      {/* Create form */}
      <Card className="overflow-hidden border-border/50 shadow-sm">
        <div className="h-1 bg-gradient-to-r from-purple-500 via-violet-500 to-indigo-500" />
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500/20 to-violet-500/20 border border-purple-500/20">
              <CalendarClock className="h-4 w-4 text-purple-500" />
            </div>
            Scheduled Scraping
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Set up recurring scrape jobs with cron expressions
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Schedule name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 h-10"
            />
            <Input
              placeholder="0 */6 * * *"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              className="w-44 h-10 font-mono text-sm"
            />
            <Button
              onClick={() => {
                createSchedule.mutate(
                  { name, jobConfig: {}, cronExpression: cron },
                  {
                    onSuccess: () => {
                      setName("");
                      showSuccess("Schedule created");
                    },
                    onError: (err) => showError(err.message),
                  },
                );
              }}
              disabled={!name.trim() || createSchedule.isPending}
              className="h-10 bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 shadow-lg shadow-purple-500/20 border-0 text-white"
            >
              {createSchedule.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Plus className="h-4 w-4 mr-1.5" />
              )}
              Create
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Schedule list */}
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {schedules.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16 text-muted-foreground"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-500/5 border border-purple-500/10 mb-4">
                <Clock className="h-8 w-8 text-purple-500/30" />
              </div>
              <p className="font-medium text-foreground/60">No schedules yet</p>
              <p className="text-sm mt-1">Configure recurring scrape jobs to run automatically</p>
            </motion.div>
          ) : (
            schedules.map((s: any) => (
              <motion.div key={s.id} {...staggerItem} layout>
                <Card
                  className={`group overflow-hidden border-border/50 transition-all duration-200 hover:shadow-md hover:border-border ${
                    s.enabled ? "hover:border-purple-500/30" : "opacity-60"
                  }`}
                >
                  <div className={`absolute left-0 top-0 h-full w-1 ${s.enabled ? "bg-gradient-to-b from-purple-500 to-violet-500" : "bg-gray-300 dark:bg-gray-700"}`} />
                  <CardContent className="p-4 pl-5 flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{s.name}</p>
                        {s.enabled ? (
                          <Badge variant="outline" className="text-xs text-emerald-500 border-emerald-500/20 bg-emerald-500/5">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-gray-400">Paused</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <code className="rounded-md bg-muted/60 px-2 py-0.5 font-mono text-xs">
                          {s.cronExpression}
                        </code>
                        {s.lastRunAt && (
                          <span className="flex items-center gap-1 text-xs">
                            <Timer className="h-3 w-3" />
                            {new Date(s.lastRunAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={s.enabled}
                        onCheckedChange={(enabled) =>
                          toggleSchedule.mutate({ id: s.id, enabled })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteSchedule.mutate(s.id)}
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
