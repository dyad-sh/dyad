/**
 * CalendarPage — Unified calendar with all sources, views, and agent scheduling
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Trash2,
  Edit,
  Clock,
  MapPin,
  Users,
  Bot,
  Download,
  Settings,
  Check,
  X,
  Loader2,
  AlertCircle,
  MoreVertical,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  getHours,
  getMinutes,
  getDay,
  setHours,
  setMinutes,
  startOfDay,
  endOfDay,
  isToday,
  parseISO,
} from "date-fns";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────

interface CalendarSource {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  color: string;
  syncStatus: string;
  syncError: string | null;
  lastSyncAt: string | null;
  syncIntervalMinutes: number;
  configJson: Record<string, unknown>;
  authJson: Record<string, unknown>;
}

interface CalendarEvent {
  id: string;
  sourceId: string;
  externalId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  isAllDay: boolean;
  location: string | null;
  status: string;
  type: string;
  recurrenceRule: string | null;
  attendeesJson: Array<{ name?: string; email: string; status?: string }> | null;
  agentId: string | null;
  agentName: string | null;
  metadataJson: Record<string, unknown> | null;
  icsData: string | null;
  isReadOnly: boolean;
}

type ViewMode = "month" | "week" | "day" | "agenda";

// ── Helpers ───────────────────────────────────────────────────────────────

const ipc = IpcClient.getInstance();

function eventDate(dateVal: string | Date): Date {
  if (typeof dateVal === "string") return new Date(dateVal);
  return dateVal;
}

function getEventColor(event: CalendarEvent, sources: CalendarSource[]): string {
  const source = sources.find((s) => s.id === event.sourceId);
  return source?.color ?? "#3b82f6";
}

function eventTimeLabel(event: CalendarEvent): string {
  if (event.isAllDay) return "All day";
  const start = eventDate(event.startAt);
  const end = event.endAt ? eventDate(event.endAt) : null;
  const s = format(start, "h:mm a");
  return end ? `${s} - ${format(end, "h:mm a")}` : s;
}

const TYPE_LABELS: Record<string, string> = {
  meeting: "Meeting",
  task: "Task",
  agent_run: "Agent Run",
  agent_post: "Agent Post",
  agent_task: "Agent Task",
  reminder: "Reminder",
  custom: "Custom",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  google: "Google Calendar",
  outlook: "Outlook Calendar",
  ical: "iCal Feed",
  caldav: "CalDAV",
  agent: "Agent Activity",
};

// ── Main Component ────────────────────────────────────────────────────────

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showAddSource, setShowAddSource] = useState(false);
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [showEventDetail, setShowEventDetail] = useState(false);
  const [hiddenSourceIds, setHiddenSourceIds] = useState<Set<string>>(new Set());

  // Calculate date range for queries based on view
  const dateRange = useMemo(() => {
    let start: Date;
    let end: Date;
    if (viewMode === "month") {
      start = startOfWeek(startOfMonth(currentDate));
      end = endOfWeek(endOfMonth(currentDate));
    } else if (viewMode === "week") {
      start = startOfWeek(currentDate);
      end = endOfWeek(currentDate);
    } else if (viewMode === "day") {
      start = startOfDay(currentDate);
      end = endOfDay(currentDate);
    } else {
      // agenda: 30 days from current
      start = startOfDay(currentDate);
      end = endOfDay(addDays(currentDate, 30));
    }
    return {
      startAt: Math.floor(start.getTime() / 1000),
      endAt: Math.floor(end.getTime() / 1000),
    };
  }, [currentDate, viewMode]);

  // ── Queries ───────────────────────────────────────────────────────────

  const sourcesQuery = useQuery({
    queryKey: ["calendar", "sources"],
    queryFn: () => ipc.calendarListSources() as Promise<CalendarSource[]>,
  });

  const eventsQuery = useQuery({
    queryKey: ["calendar", "events", dateRange.startAt, dateRange.endAt],
    queryFn: () =>
      ipc.calendarListEvents({
        startAt: dateRange.startAt,
        endAt: dateRange.endAt,
        includeAgentActivity: true,
      }) as Promise<CalendarEvent[]>,
  });

  const sources = sourcesQuery.data ?? [];
  const allEvents = eventsQuery.data ?? [];

  // Filter hidden sources
  const events = useMemo(
    () => allEvents.filter((e) => !hiddenSourceIds.has(e.sourceId)),
    [allEvents, hiddenSourceIds],
  );

  // ── Mutations ─────────────────────────────────────────────────────────

  const syncAllMutation = useMutation({
    mutationFn: () => ipc.calendarSyncAll(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      toast.success("Calendar sync complete");
    },
    onError: (err: Error) => toast.error(`Sync failed: ${err.message}`),
  });

  const removeSourceMutation = useMutation({
    mutationFn: (id: string) => ipc.calendarRemoveSource({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      toast.success("Source removed");
    },
    onError: (err: Error) => toast.error(`Remove failed: ${err.message}`),
  });

  const deleteEventMutation = useMutation({
    mutationFn: (id: string) => ipc.calendarDeleteEvent({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar", "events"] });
      setShowEventDetail(false);
      setSelectedEvent(null);
      toast.success("Event deleted");
    },
    onError: (err: Error) => toast.error(`Delete failed: ${err.message}`),
  });

  // ── Navigation ────────────────────────────────────────────────────────

  const navigatePrev = useCallback(() => {
    if (viewMode === "month") setCurrentDate((d) => subMonths(d, 1));
    else if (viewMode === "week") setCurrentDate((d) => subWeeks(d, 1));
    else setCurrentDate((d) => subDays(d, 1));
  }, [viewMode]);

  const navigateNext = useCallback(() => {
    if (viewMode === "month") setCurrentDate((d) => addMonths(d, 1));
    else if (viewMode === "week") setCurrentDate((d) => addWeeks(d, 1));
    else setCurrentDate((d) => addDays(d, 1));
  }, [viewMode]);

  const navigateToday = useCallback(() => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  }, []);

  const toggleSource = useCallback((sourceId: string) => {
    setHiddenSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }, []);

  // ── Sync progress listener ─────────────────────────────────────────────

  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
    };
    const el = window.electron?.ipcRenderer;
    el?.on("calendar:sync-complete", handler);
    return () => {
      el?.removeListener?.("calendar:sync-complete", handler);
    };
  }, [queryClient]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* Left sidebar - Sources + Mini calendar */}
      <div className="w-64 border-r flex flex-col shrink-0">
        <div className="p-3 border-b">
          <Button
            size="sm"
            className="w-full"
            onClick={() => setShowNewEvent(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            New Event
          </Button>
        </div>

        {/* Mini calendar */}
        <div className="p-3 border-b">
          <MiniCalendar
            currentDate={currentDate}
            selectedDate={selectedDate}
            events={events}
            onSelectDate={(d) => {
              setSelectedDate(d);
              setCurrentDate(d);
            }}
          />
        </div>

        {/* Sources */}
        <div className="p-3 flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase">Sources</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => setShowAddSource(true)}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          <ScrollArea className="h-[calc(100%-28px)]">
            <div className="space-y-1">
              {sources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-center gap-2 group px-1 py-1 rounded hover:bg-muted/50"
                >
                  <button
                    className="flex items-center gap-2 flex-1 min-w-0"
                    onClick={() => toggleSource(source.id)}
                  >
                    <div
                      className={cn(
                        "w-3 h-3 rounded-sm shrink-0",
                        hiddenSourceIds.has(source.id) && "opacity-30",
                      )}
                      style={{ backgroundColor: source.color }}
                    />
                    <span className={cn(
                      "text-xs truncate",
                      hiddenSourceIds.has(source.id) && "text-muted-foreground line-through",
                    )}>
                      {source.name}
                    </span>
                  </button>
                  {source.syncStatus === "syncing" && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                  {source.syncStatus === "error" && (
                    <AlertCircle className="h-3 w-3 text-destructive" />
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100"
                      >
                        <MoreVertical className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          ipc.calendarSyncSource({ id: source.id }).then(() => {
                            queryClient.invalidateQueries({ queryKey: ["calendar"] });
                          });
                        }}
                      >
                        <RefreshCw className="h-3 w-3 mr-2" />
                        Sync Now
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => removeSourceMutation.mutate(source.id)}
                      >
                        <Trash2 className="h-3 w-3 mr-2" />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
              {sources.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">
                  No calendar sources. Click + to add one.
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="h-12 border-b flex items-center gap-2 px-4 shrink-0">
          <Button variant="outline" size="sm" onClick={navigateToday}>
            Today
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={navigatePrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={navigateNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold ml-2">
            {viewMode === "month" && format(currentDate, "MMMM yyyy")}
            {viewMode === "week" && `${format(startOfWeek(currentDate), "MMM d")} – ${format(endOfWeek(currentDate), "MMM d, yyyy")}`}
            {viewMode === "day" && format(currentDate, "EEEE, MMMM d, yyyy")}
            {viewMode === "agenda" && `${format(currentDate, "MMM d")} – ${format(addDays(currentDate, 30), "MMM d, yyyy")}`}
          </h2>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => syncAllMutation.mutate()}
              disabled={syncAllMutation.isPending}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", syncAllMutation.isPending && "animate-spin")} />
              Sync
            </Button>
            {(["month", "week", "day", "agenda"] as ViewMode[]).map((v) => (
              <Button
                key={v}
                variant={viewMode === v ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode(v)}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        {/* Calendar views */}
        <div className="flex-1 overflow-auto min-h-0">
          {eventsQuery.isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : viewMode === "month" ? (
            <MonthView
              currentDate={currentDate}
              selectedDate={selectedDate}
              events={events}
              sources={sources}
              onSelectDate={(d) => {
                setSelectedDate(d);
                setCurrentDate(d);
              }}
              onSelectEvent={(e) => {
                setSelectedEvent(e);
                setShowEventDetail(true);
              }}
            />
          ) : viewMode === "week" ? (
            <WeekView
              currentDate={currentDate}
              events={events}
              sources={sources}
              onSelectEvent={(e) => {
                setSelectedEvent(e);
                setShowEventDetail(true);
              }}
            />
          ) : viewMode === "day" ? (
            <DayView
              currentDate={currentDate}
              events={events}
              sources={sources}
              onSelectEvent={(e) => {
                setSelectedEvent(e);
                setShowEventDetail(true);
              }}
            />
          ) : (
            <AgendaView
              currentDate={currentDate}
              events={events}
              sources={sources}
              onSelectEvent={(e) => {
                setSelectedEvent(e);
                setShowEventDetail(true);
              }}
            />
          )}
        </div>
      </div>

      {/* Dialogs */}
      <AddSourceDialog
        open={showAddSource}
        onOpenChange={setShowAddSource}
      />
      <NewEventDialog
        open={showNewEvent}
        onOpenChange={setShowNewEvent}
        sources={sources}
        defaultDate={selectedDate}
      />
      <EventDetailDialog
        open={showEventDetail}
        onOpenChange={setShowEventDetail}
        event={selectedEvent}
        sources={sources}
        onDelete={(id) => deleteEventMutation.mutate(id)}
      />
    </div>
  );
}

// ── Mini Calendar ─────────────────────────────────────────────────────────

function MiniCalendar({
  currentDate,
  selectedDate,
  events,
  onSelectDate,
}: {
  currentDate: Date;
  selectedDate: Date;
  events: CalendarEvent[];
  onSelectDate: (d: Date) => void;
}) {
  const [viewMonth, setViewMonth] = useState(currentDate);

  useEffect(() => setViewMonth(currentDate), [currentDate]);

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const dayHasEvent = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) {
      set.add(format(eventDate(e.startAt), "yyyy-MM-dd"));
    }
    return set;
  }, [events]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setViewMonth((m) => subMonths(m, 1))}>
          <ChevronLeft className="h-3 w-3" />
        </Button>
        <span className="text-xs font-medium">{format(viewMonth, "MMM yyyy")}</span>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setViewMonth((m) => addMonths(m, 1))}>
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-0">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="h-6 flex items-center justify-center text-[10px] text-muted-foreground font-medium">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const inMonth = isSameMonth(day, viewMonth);
          const selected = isSameDay(day, selectedDate);
          const today = isToday(day);
          const hasEvent = dayHasEvent.has(key);

          return (
            <button
              key={key}
              onClick={() => onSelectDate(day)}
              className={cn(
                "h-6 w-full flex items-center justify-center text-[11px] rounded-sm relative",
                !inMonth && "text-muted-foreground/40",
                today && !selected && "text-blue-500 font-bold",
                selected && "bg-primary text-primary-foreground",
                !selected && "hover:bg-muted/60",
              )}
            >
              {format(day, "d")}
              {hasEvent && !selected && (
                <span className="absolute bottom-0 w-1 h-1 rounded-full bg-blue-500" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Month View ────────────────────────────────────────────────────────────

function MonthView({
  currentDate,
  selectedDate,
  events,
  sources,
  onSelectDate,
  onSelectEvent,
}: {
  currentDate: Date;
  selectedDate: Date;
  events: CalendarEvent[];
  sources: CalendarSource[];
  onSelectDate: (d: Date) => void;
  onSelectEvent: (e: CalendarEvent) => void;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = format(eventDate(e.startAt), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [events]);

  return (
    <div className="h-full flex flex-col">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-1.5 text-center text-xs font-medium text-muted-foreground border-r last:border-r-0">
            {d}
          </div>
        ))}
      </div>
      {/* Weeks */}
      <div className="flex-1 grid" style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b last:border-b-0">
            {week.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const inMonth = isSameMonth(day, currentDate);
              const selected = isSameDay(day, selectedDate);
              const today = isToday(day);
              const dayEvents = eventsByDay.get(key) ?? [];

              return (
                <div
                  key={key}
                  className={cn(
                    "border-r last:border-r-0 p-1 min-h-0 cursor-pointer overflow-hidden",
                    !inMonth && "bg-muted/30",
                    selected && "bg-primary/5",
                  )}
                  onClick={() => onSelectDate(day)}
                >
                  <div
                    className={cn(
                      "text-xs mb-0.5 w-6 h-6 flex items-center justify-center rounded-full mx-auto",
                      today && "bg-primary text-primary-foreground font-bold",
                      !inMonth && !today && "text-muted-foreground/50",
                    )}
                  >
                    {format(day, "d")}
                  </div>
                  <div className="space-y-px">
                    {dayEvents.slice(0, 3).map((evt) => (
                      <button
                        key={evt.id}
                        className="w-full text-left px-1 py-px rounded text-[10px] truncate block"
                        style={{
                          backgroundColor: `${getEventColor(evt, sources)}20`,
                          color: getEventColor(evt, sources),
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectEvent(evt);
                        }}
                      >
                        {evt.isAllDay ? "" : format(eventDate(evt.startAt), "h:mm ")}{evt.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-[10px] text-muted-foreground px-1">
                        +{dayEvents.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Week View ─────────────────────────────────────────────────────────────

function WeekView({
  currentDate,
  events,
  sources,
  onSelectEvent,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  sources: CalendarSource[];
  onSelectEvent: (e: CalendarEvent) => void;
}) {
  const weekStart = startOfWeek(currentDate);
  const days = eachDayOfInterval({ start: weekStart, end: endOfWeek(currentDate) });
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = format(eventDate(e.startAt), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [events]);

  return (
    <div className="h-full overflow-auto">
      <div className="min-w-[640px]">
        {/* Day headers */}
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b sticky top-0 bg-background z-10">
          <div className="border-r" />
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className={cn(
                "py-2 text-center border-r last:border-r-0",
                isToday(day) && "bg-primary/5",
              )}
            >
              <div className="text-xs text-muted-foreground">{format(day, "EEE")}</div>
              <div className={cn(
                "text-sm font-medium",
                isToday(day) && "text-primary",
              )}>
                {format(day, "d")}
              </div>
            </div>
          ))}
        </div>
        {/* Time grid */}
        <div className="relative">
          {hours.map((hour) => (
            <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] h-12 border-b">
              <div className="border-r text-[10px] text-muted-foreground text-right pr-1 -mt-2">
                {hour === 0 ? "" : format(setHours(new Date(), hour), "h a")}
              </div>
              {days.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const dayEvents = (eventsByDay.get(key) ?? []).filter(
                  (e) => !e.isAllDay && getHours(eventDate(e.startAt)) === hour,
                );

                return (
                  <div key={`${key}-${hour}`} className="border-r last:border-r-0 relative">
                    {dayEvents.map((evt) => {
                      const startMin = getMinutes(eventDate(evt.startAt));
                      const endTime = evt.endAt ? eventDate(evt.endAt) : new Date(eventDate(evt.startAt).getTime() + 3600_000);
                      const durationMin = Math.max(15, (endTime.getTime() - eventDate(evt.startAt).getTime()) / 60_000);
                      const heightPx = Math.min(durationMin, 120);

                      return (
                        <button
                          key={evt.id}
                          className="absolute left-0.5 right-0.5 rounded text-[10px] px-1 truncate text-left overflow-hidden"
                          style={{
                            top: `${(startMin / 60) * 100}%`,
                            height: `${heightPx}%`,
                            backgroundColor: `${getEventColor(evt, sources)}20`,
                            borderLeft: `2px solid ${getEventColor(evt, sources)}`,
                            color: getEventColor(evt, sources),
                          }}
                          onClick={() => onSelectEvent(evt)}
                        >
                          {evt.title}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Day View ──────────────────────────────────────────────────────────────

function DayView({
  currentDate,
  events,
  sources,
  onSelectEvent,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  sources: CalendarSource[];
  onSelectEvent: (e: CalendarEvent) => void;
}) {
  const dayKey = format(currentDate, "yyyy-MM-dd");
  const dayEvents = useMemo(
    () => events.filter((e) => format(eventDate(e.startAt), "yyyy-MM-dd") === dayKey),
    [events, dayKey],
  );

  const allDayEvents = dayEvents.filter((e) => e.isAllDay);
  const timedEvents = dayEvents.filter((e) => !e.isAllDay);
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="h-full overflow-auto">
      {/* All - day */}
      {allDayEvents.length > 0 && (
        <div className="border-b p-2 space-y-1">
          <span className="text-xs text-muted-foreground">All day</span>
          {allDayEvents.map((evt) => (
            <button
              key={evt.id}
              className="block w-full text-left px-2 py-1 rounded text-xs truncate"
              style={{
                backgroundColor: `${getEventColor(evt, sources)}20`,
                color: getEventColor(evt, sources),
              }}
              onClick={() => onSelectEvent(evt)}
            >
              {evt.title}
            </button>
          ))}
        </div>
      )}
      {/* Time grid */}
      {hours.map((hour) => {
        const hourEvents = timedEvents.filter(
          (e) => getHours(eventDate(e.startAt)) === hour,
        );
        return (
          <div key={hour} className="flex border-b h-14">
            <div className="w-16 shrink-0 text-[10px] text-muted-foreground text-right pr-2 -mt-2">
              {hour === 0 ? "" : format(setHours(new Date(), hour), "h a")}
            </div>
            <div className="flex-1 relative border-l">
              {hourEvents.map((evt) => {
                const startMin = getMinutes(eventDate(evt.startAt));
                return (
                  <button
                    key={evt.id}
                    className="absolute left-1 right-1 rounded text-xs px-2 py-0.5 truncate text-left"
                    style={{
                      top: `${(startMin / 60) * 100}%`,
                      backgroundColor: `${getEventColor(evt, sources)}20`,
                      borderLeft: `3px solid ${getEventColor(evt, sources)}`,
                      color: getEventColor(evt, sources),
                    }}
                    onClick={() => onSelectEvent(evt)}
                  >
                    {format(eventDate(evt.startAt), "h:mm a")} {evt.title}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Agenda View ───────────────────────────────────────────────────────────

function AgendaView({
  currentDate,
  events,
  sources,
  onSelectEvent,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  sources: CalendarSource[];
  onSelectEvent: (e: CalendarEvent) => void;
}) {
  const sorted = useMemo(
    () =>
      [...events].sort(
        (a, b) => eventDate(a.startAt).getTime() - eventDate(b.startAt).getTime(),
      ),
    [events],
  );

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of sorted) {
      const key = format(eventDate(e.startAt), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries());
  }, [sorted]);

  if (grouped.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No events in the next 30 days
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4 max-w-3xl mx-auto">
        {grouped.map(([dateKey, dayEvents]) => {
          const date = new Date(dateKey);
          return (
            <div key={dateKey}>
              <div className="flex items-center gap-3 mb-2">
                <div className={cn(
                  "text-center w-12",
                  isToday(date) && "text-primary",
                )}>
                  <div className="text-xs text-muted-foreground">{format(date, "EEE")}</div>
                  <div className="text-lg font-bold">{format(date, "d")}</div>
                </div>
                <Separator className="flex-1" />
              </div>
              <div className="space-y-1 ml-14">
                {dayEvents.map((evt) => (
                  <button
                    key={evt.id}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 text-left group"
                    onClick={() => onSelectEvent(evt)}
                  >
                    <div
                      className="w-1 h-8 rounded-full shrink-0"
                      style={{ backgroundColor: getEventColor(evt, sources) }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{evt.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {eventTimeLabel(evt)}
                        {evt.location && ` · ${evt.location}`}
                      </div>
                    </div>
                    {evt.agentName && (
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        <Bot className="h-3 w-3 mr-0.5" />
                        {evt.agentName}
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// ── Event Detail Dialog ───────────────────────────────────────────────────

function EventDetailDialog({
  open,
  onOpenChange,
  event,
  sources,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  event: CalendarEvent | null;
  sources: CalendarSource[];
  onDelete: (id: string) => void;
}) {
  if (!event) return null;

  const source = sources.find((s) => s.id === event.sourceId);
  const start = eventDate(event.startAt);
  const end = event.endAt ? eventDate(event.endAt) : null;

  const handleExportIcs = async () => {
    try {
      const ics = await ipc.calendarExportIcs({ eventId: event.id });
      const blob = new Blob([ics], { type: "text/calendar" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${event.title.replace(/[^a-z0-9]/gi, "_")}.ics`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("ICS file downloaded");
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: source?.color ?? "#3b82f6" }}
            />
            <DialogTitle className="text-base">{event.title}</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            {source?.name ?? "Unknown Source"} · {TYPE_LABELS[event.type] ?? event.type}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Time */}
          <div className="flex items-start gap-2 text-sm">
            <Clock className="h-4 w-4 mt-0.5 text-muted-foreground" />
            <div>
              {event.isAllDay ? (
                <span>{format(start, "EEEE, MMMM d, yyyy")} (All day)</span>
              ) : (
                <>
                  <div>{format(start, "EEEE, MMMM d, yyyy")}</div>
                  <div className="text-muted-foreground">
                    {format(start, "h:mm a")}
                    {end && ` – ${format(end, "h:mm a")}`}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Location */}
          {event.location && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <span>{event.location}</span>
            </div>
          )}

          {/* Agent */}
          {event.agentName && (
            <div className="flex items-start gap-2 text-sm">
              <Bot className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <span>{event.agentName}</span>
            </div>
          )}

          {/* Attendees */}
          {event.attendeesJson && event.attendeesJson.length > 0 && (
            <div className="flex items-start gap-2 text-sm">
              <Users className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div className="space-y-0.5">
                {event.attendeesJson.map((a, i) => (
                  <div key={i} className="text-xs">
                    {a.name ? `${a.name} (${a.email})` : a.email}
                    {a.status && (
                      <Badge variant="outline" className="ml-1 text-[10px]">{a.status}</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {event.description && (
            <div className="text-sm text-muted-foreground border-t pt-2 whitespace-pre-wrap">
              {event.description}
            </div>
          )}

          {/* Status */}
          {event.status && event.status !== "confirmed" && (
            <Badge variant="secondary">{event.status}</Badge>
          )}
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" size="sm" onClick={handleExportIcs}>
            <Download className="h-3 w-3 mr-1" />
            Export ICS
          </Button>
          {!event.isReadOnly && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDelete(event.id)}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Source Dialog ──────────────────────────────────────────────────────

function AddSourceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [sourceType, setSourceType] = useState<string>("ical");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3b82f6");

  // iCal
  const [icalUrl, setIcalUrl] = useState("");
  // Google
  const [gClientId, setGClientId] = useState("");
  const [gClientSecret, setGClientSecret] = useState("");
  // Outlook
  const [oClientId, setOClientId] = useState("");
  // CalDAV
  const [caldavUrl, setCaldavUrl] = useState("");
  const [caldavUser, setCaldavUser] = useState("");
  const [caldavPass, setCaldavPass] = useState("");

  const addMutation = useMutation({
    mutationFn: (params: Parameters<typeof ipc.calendarAddSource>[0]) =>
      ipc.calendarAddSource(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      toast.success("Calendar source added");
      onOpenChange(false);
      resetForm();
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  const resetForm = () => {
    setName("");
    setSourceType("ical");
    setColor("#3b82f6");
    setIcalUrl("");
    setGClientId("");
    setGClientSecret("");
    setOClientId("");
    setCaldavUrl("");
    setCaldavUser("");
    setCaldavPass("");
  };

  const handleAdd = () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    let configJson: Record<string, unknown> = {};
    let authJson: Record<string, unknown> = {};

    switch (sourceType) {
      case "ical":
        if (!icalUrl.trim()) {
          toast.error("iCal URL is required");
          return;
        }
        configJson = { url: icalUrl.trim() };
        break;
      case "google":
        if (!gClientId.trim() || !gClientSecret.trim()) {
          toast.error("Client ID and Secret are required");
          return;
        }
        authJson = { clientId: gClientId.trim(), clientSecret: gClientSecret.trim() };
        configJson = { calendarId: "primary" };
        break;
      case "outlook":
        if (!oClientId.trim()) {
          toast.error("Client ID is required");
          return;
        }
        authJson = { clientId: oClientId.trim() };
        break;
      case "caldav":
        if (!caldavUrl.trim() || !caldavUser.trim() || !caldavPass.trim()) {
          toast.error("All CalDAV fields are required");
          return;
        }
        configJson = { serverUrl: caldavUrl.trim() };
        authJson = { username: caldavUser.trim(), password: caldavPass.trim() };
        break;
      case "agent":
        configJson = { includeKanbanTasks: true, includeChannelMessages: true, includeExecutions: true };
        break;
    }

    addMutation.mutate({
      name: name.trim(),
      type: sourceType,
      color,
      configJson,
      authJson,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Calendar Source</DialogTitle>
          <DialogDescription>Connect an external calendar or agent activity feed.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Calendar"
              />
            </div>
            <div>
              <Label className="text-xs">Color</Label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-8 h-8 rounded border cursor-pointer"
                />
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="flex-1"
                  maxLength={7}
                />
              </div>
            </div>
          </div>

          <div>
            <Label className="text-xs">Source Type</Label>
            <Select value={sourceType} onValueChange={setSourceType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ical">iCal Feed (URL)</SelectItem>
                <SelectItem value="google">Google Calendar</SelectItem>
                <SelectItem value="outlook">Outlook Calendar</SelectItem>
                <SelectItem value="caldav">CalDAV (Nextcloud, etc.)</SelectItem>
                <SelectItem value="agent">Agent Activity</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {sourceType === "ical" && (
            <div>
              <Label className="text-xs">iCal URL</Label>
              <Input
                value={icalUrl}
                onChange={(e) => setIcalUrl(e.target.value)}
                placeholder="https://calendar.example.com/feed.ics"
              />
            </div>
          )}

          {sourceType === "google" && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">OAuth Client ID</Label>
                <Input
                  value={gClientId}
                  onChange={(e) => setGClientId(e.target.value)}
                  placeholder="xxxxxxxx.apps.googleusercontent.com"
                />
              </div>
              <div>
                <Label className="text-xs">OAuth Client Secret</Label>
                <Input
                  type="password"
                  value={gClientSecret}
                  onChange={(e) => setGClientSecret(e.target.value)}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Create OAuth credentials in the Google Cloud Console. Enable the Google Calendar API.
              </p>
            </div>
          )}

          {sourceType === "outlook" && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Azure App Client ID</Label>
                <Input
                  value={oClientId}
                  onChange={(e) => setOClientId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Register an app in Azure AD with Calendars.ReadWrite permissions.
              </p>
            </div>
          )}

          {sourceType === "caldav" && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Server URL</Label>
                <Input
                  value={caldavUrl}
                  onChange={(e) => setCaldavUrl(e.target.value)}
                  placeholder="https://cloud.example.com/remote.php/dav"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Username</Label>
                  <Input
                    value={caldavUser}
                    onChange={(e) => setCaldavUser(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Password</Label>
                  <Input
                    type="password"
                    value={caldavPass}
                    onChange={(e) => setCaldavPass(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {sourceType === "agent" && (
            <p className="text-xs text-muted-foreground">
              Shows activity from your running agents and bots — task executions, posts, and workflow runs.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={addMutation.isPending}>
            {addMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Add Source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── New Event Dialog ──────────────────────────────────────────────────────

function NewEventDialog({
  open,
  onOpenChange,
  sources,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sources: CalendarSource[];
  defaultDate: Date;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(format(defaultDate, "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [location, setLocation] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
  const [eventType, setEventType] = useState("meeting");
  const [sourceId, setSourceId] = useState("");

  // Agent-specific
  const [agentId, setAgentId] = useState("");
  const [agentName, setAgentName] = useState("");

  useEffect(() => {
    setDate(format(defaultDate, "yyyy-MM-dd"));
  }, [defaultDate]);

  // Pick first writable source as default
  const writableSources = useMemo(
    () => sources.filter((s) => s.type !== "agent" || eventType.startsWith("agent_")),
    [sources, eventType],
  );

  useEffect(() => {
    if (writableSources.length > 0 && !sourceId) {
      setSourceId(writableSources[0].id);
    }
  }, [writableSources, sourceId]);

  const createMutation = useMutation({
    mutationFn: () => {
      const dateObj = new Date(`${date}T00:00:00`);
      let startAt: number;
      let endAt: number | undefined;

      if (isAllDay) {
        startAt = Math.floor(startOfDay(dateObj).getTime() / 1000);
        endAt = Math.floor(endOfDay(dateObj).getTime() / 1000);
      } else {
        const [sh, sm] = startTime.split(":").map(Number);
        const [eh, em] = endTime.split(":").map(Number);
        const startDate = setMinutes(setHours(dateObj, sh), sm);
        const endDate = setMinutes(setHours(dateObj, eh), em);
        startAt = Math.floor(startDate.getTime() / 1000);
        endAt = Math.floor(endDate.getTime() / 1000);
      }

      if (eventType.startsWith("agent_")) {
        return ipc.calendarScheduleAgentEvent({
          title,
          description: description || undefined,
          startAt,
          endAt,
          type: eventType as "agent_run" | "agent_post" | "agent_task",
          agentId,
          agentName,
        });
      }

      return ipc.calendarCreateEvent({
        sourceId,
        event: {
          title,
          description: description || undefined,
          startAt,
          endAt,
          isAllDay,
          location: location || undefined,
        },
        type: eventType,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      toast.success("Event created");
      onOpenChange(false);
      resetForm();
    },
    onError: (err: Error) => toast.error(`Failed: ${err.message}`),
  });

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setStartTime("09:00");
    setEndTime("10:00");
    setLocation("");
    setIsAllDay(false);
    setEventType("meeting");
    setAgentId("");
    setAgentName("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Event</DialogTitle>
          <DialogDescription>Create a new calendar event or schedule an agent task.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Meeting with team"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="meeting">Meeting</SelectItem>
                  <SelectItem value="task">Task</SelectItem>
                  <SelectItem value="reminder">Reminder</SelectItem>
                  <SelectItem value="agent_run">Agent Run</SelectItem>
                  <SelectItem value="agent_post">Agent Post</SelectItem>
                  <SelectItem value="agent_task">Agent Task</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!eventType.startsWith("agent_") && writableSources.length > 0 && (
              <div>
                <Label className="text-xs">Calendar</Label>
                <Select value={sourceId} onValueChange={setSourceId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {writableSources.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={isAllDay} onCheckedChange={setIsAllDay} />
            <Label className="text-xs">All day</Label>
          </div>

          {!isAllDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Start</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">End</Label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          )}

          {!eventType.startsWith("agent_") && (
            <div>
              <Label className="text-xs">Location</Label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Room 101 / Zoom link"
              />
            </div>
          )}

          {eventType.startsWith("agent_") && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Agent ID</Label>
                <Input
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  placeholder="agent-uuid"
                />
              </div>
              <div>
                <Label className="text-xs">Agent Name</Label>
                <Input
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="My Bot"
                />
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Details..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!title.trim() || createMutation.isPending}
          >
            {createMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
