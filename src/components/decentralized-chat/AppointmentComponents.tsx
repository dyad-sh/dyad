/**
 * Appointment & Scheduling Components
 * World-class decentralized calendar and scheduling
 */

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Calendar,
  CalendarDays,
  CalendarClock,
  Clock,
  Plus,
  Search,
  MoreVertical,
  Edit,
  Trash2,
  Bell,
  BellOff,
  Video,
  MapPin,
  Link,
  Copy,
  Check,
  X,
  Users,
  User,
  Repeat,
  Loader2,
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Globe,
  Lock,
  ExternalLink,
  RefreshCw,
  Send,
  Mail,
  Share2,
} from "lucide-react";
import { format, addDays, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, isBefore, isAfter, addHours, setHours, setMinutes } from "date-fns";
import type {
  Appointment,
  AppointmentType,
  AppointmentStatus,
  AppointmentAttendee,
  RecurrenceRule,
  AppointmentReminder,
  ChatIdentity,
} from "@/types/decentralized_chat_types";

// Recurrence frequency type
type RecurrenceFrequency = RecurrenceRule["frequency"];

// ============================================================================
// Create Appointment Dialog
// ============================================================================

interface CreateAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId?: string;
  selectedDate?: Date;
  onAppointmentCreated?: (appointment: Appointment) => void;
}

export function CreateAppointmentDialog({
  open,
  onOpenChange,
  conversationId,
  selectedDate,
  onAppointmentCreated,
}: CreateAppointmentDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [appointmentType, setAppointmentType] = useState<AppointmentType>("meeting");
  const [date, setDate] = useState<Date | undefined>(selectedDate || new Date());
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");
  const [location, setLocation] = useState("");
  const [isVirtual, setIsVirtual] = useState(true);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency>("weekly");
  const [reminderMinutes, setReminderMinutes] = useState(15);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!date) {
      setError("Date is required");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      // Create appointment via IPC
      // const result = await createAppointment({ ... });
      // onAppointmentCreated?.(result.appointment);
      onOpenChange(false);
      resetForm();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setAppointmentType("meeting");
    setDate(new Date());
    setStartTime("10:00");
    setEndTime("11:00");
    setLocation("");
    setIsVirtual(true);
    setIsRecurring(false);
    setError(null);
  };

  const timeOptions = useMemo(() => {
    const options = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        const hour = h.toString().padStart(2, "0");
        const min = m.toString().padStart(2, "0");
        options.push(`${hour}:${min}`);
      }
    }
    return options;
  }, []);

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!o) resetForm();
      onOpenChange(o);
    }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            Schedule Appointment
          </DialogTitle>
          <DialogDescription>
            Create a new appointment or meeting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label>Title *</Label>
            <Input
              placeholder="Team sync meeting"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Type */}
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={appointmentType} onValueChange={(v) => setAppointmentType(v as AppointmentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="meeting">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Meeting
                  </div>
                </SelectItem>
                <SelectItem value="call">
                  <div className="flex items-center gap-2">
                    <Video className="h-4 w-4" />
                    Video Call
                  </div>
                </SelectItem>
                <SelectItem value="event">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Event
                  </div>
                </SelectItem>
                <SelectItem value="reminder">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    Reminder
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left">
                    <Calendar className="h-4 w-4 mr-2" />
                    {date ? format(date, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  {/* Simple date input for now - can be replaced with a calendar component */}
                  <div className="p-3">
                    <Input
                      type="date"
                      value={date ? format(date, "yyyy-MM-dd") : ""}
                      onChange={(e) => setDate(e.target.value ? new Date(e.target.value) : undefined)}
                    />
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Start Time</Label>
              <Select value={startTime} onValueChange={setStartTime}>
                <SelectTrigger>
                  <Clock className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {timeOptions.map((time) => (
                    <SelectItem key={time} value={time}>{time}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>End Time</Label>
              <Select value={endTime} onValueChange={setEndTime}>
                <SelectTrigger>
                  <Clock className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {timeOptions.map((time) => (
                    <SelectItem key={time} value={time}>{time}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Reminder</Label>
              <Select value={reminderMinutes.toString()} onValueChange={(v) => setReminderMinutes(Number(v))}>
                <SelectTrigger>
                  <Bell className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 minutes before</SelectItem>
                  <SelectItem value="10">10 minutes before</SelectItem>
                  <SelectItem value="15">15 minutes before</SelectItem>
                  <SelectItem value="30">30 minutes before</SelectItem>
                  <SelectItem value="60">1 hour before</SelectItem>
                  <SelectItem value="1440">1 day before</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Location/Virtual */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Virtual Meeting</Label>
              <Switch checked={isVirtual} onCheckedChange={setIsVirtual} />
            </div>
          </div>

          {!isVirtual && (
            <div className="space-y-2">
              <Label>Location</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Enter location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          )}

          {/* Recurrence */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Repeat className="h-4 w-4" />
                <Label>Recurring</Label>
              </div>
              <Switch checked={isRecurring} onCheckedChange={setIsRecurring} />
            </div>
          </div>

          {isRecurring && (
            <div className="space-y-2 ml-6">
              <Label>Repeat</Label>
              <Select value={recurrenceFrequency} onValueChange={(v) => setRecurrenceFrequency(v as RecurrenceFrequency)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Description */}
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              placeholder="Add details about this appointment..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* Attendees */}
          <div className="space-y-2">
            <Label>Attendees</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search for people to invite..."
                className="pl-9"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-500 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Appointment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Calendar View Component
// ============================================================================

interface CalendarViewProps {
  appointments: Appointment[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onSelectAppointment: (appointment: Appointment) => void;
  onCreateAppointment: (date?: Date) => void;
}

export function CalendarView({
  appointments,
  selectedDate,
  onSelectDate,
  onSelectAppointment,
  onCreateAppointment,
}: CalendarViewProps) {
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [currentDate, setCurrentDate] = useState(new Date());

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate);
    const end = endOfWeek(currentDate);
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
    const end = endOfWeek(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0));
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const getAppointmentsForDay = (date: Date) => {
    return appointments.filter((apt) => {
      const aptDate = new Date(apt.startTime);
      return isSameDay(aptDate, date);
    });
  };

  const navigatePrevious = () => {
    if (view === "month") {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    } else if (view === "week") {
      setCurrentDate(addDays(currentDate, -7));
    } else {
      setCurrentDate(addDays(currentDate, -1));
    }
  };

  const navigateNext = () => {
    if (view === "month") {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    } else if (view === "week") {
      setCurrentDate(addDays(currentDate, 7));
    } else {
      setCurrentDate(addDays(currentDate, 1));
    }
  };

  const getStatusColor = (status: AppointmentStatus) => {
    switch (status) {
      case "confirmed": return "bg-green-500";
      case "pending": return "bg-yellow-500";
      case "cancelled": return "bg-red-500";
      case "completed": return "bg-blue-500";
      default: return "bg-gray-500";
    }
  };

  const getTypeIcon = (type: AppointmentType) => {
    switch (type) {
      case "meeting": return <Users className="h-3 w-3" />;
      case "call": return <Video className="h-3 w-3" />;
      case "event": return <Calendar className="h-3 w-3" />;
      case "reminder": return <Bell className="h-3 w-3" />;
      default: return <CalendarClock className="h-3 w-3" />;
    }
  };

  return (
    <Card className="flex-1 flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={navigatePrevious}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-lg font-semibold">
              {view === "month" && format(currentDate, "MMMM yyyy")}
              {view === "week" && `Week of ${format(weekDays[0], "MMM d")}`}
              {view === "day" && format(currentDate, "EEEE, MMMM d")}
            </h2>
            <Button variant="ghost" size="icon" onClick={navigateNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentDate(new Date())}
            >
              Today
            </Button>
            
            <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
              <TabsList>
                <TabsTrigger value="month" className="text-xs">Month</TabsTrigger>
                <TabsTrigger value="week" className="text-xs">Week</TabsTrigger>
                <TabsTrigger value="day" className="text-xs">Day</TabsTrigger>
              </TabsList>
            </Tabs>

            <Button size="sm" onClick={() => onCreateAppointment(selectedDate)}>
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-2">
        {view === "month" && (
          <div className="h-full flex flex-col">
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} className="text-center text-xs font-medium text-muted-foreground py-1">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1 flex-1">
              {monthDays.map((day) => {
                const dayAppointments = getAppointmentsForDay(day);
                const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                const isToday = isSameDay(day, new Date());
                const isSelected = isSameDay(day, selectedDate);

                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      "min-h-[80px] p-1 rounded-lg cursor-pointer transition-colors border",
                      !isCurrentMonth && "opacity-40",
                      isToday && "bg-primary/10 border-primary",
                      isSelected && "ring-2 ring-primary",
                      !isToday && !isSelected && "hover:bg-muted/50 border-transparent"
                    )}
                    onClick={() => onSelectDate(day)}
                  >
                    <div className="text-xs font-medium mb-1">
                      {format(day, "d")}
                    </div>
                    <div className="space-y-0.5">
                      {dayAppointments.slice(0, 3).map((apt) => (
                        <div
                          key={apt.id}
                          className={cn(
                            "text-xs px-1 py-0.5 rounded truncate text-white cursor-pointer",
                            getStatusColor(apt.status)
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectAppointment(apt);
                          }}
                        >
                          {format(new Date(apt.startTime), "HH:mm")} {apt.title}
                        </div>
                      ))}
                      {dayAppointments.length > 3 && (
                        <div className="text-xs text-muted-foreground px-1">
                          +{dayAppointments.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view === "week" && (
          <div className="h-full flex flex-col">
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {weekDays.map((day) => {
                const isToday = isSameDay(day, new Date());
                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      "text-center py-2 rounded-lg cursor-pointer",
                      isToday && "bg-primary text-primary-foreground",
                      !isToday && "hover:bg-muted"
                    )}
                    onClick={() => onSelectDate(day)}
                  >
                    <div className="text-xs">{format(day, "EEE")}</div>
                    <div className="text-lg font-semibold">{format(day, "d")}</div>
                  </div>
                );
              })}
            </div>

            {/* Time grid */}
            <ScrollArea className="flex-1">
              <div className="grid grid-cols-7 gap-1 min-h-[600px]">
                {weekDays.map((day) => {
                  const dayAppointments = getAppointmentsForDay(day);
                  return (
                    <div key={day.toISOString()} className="space-y-1">
                      {dayAppointments.map((apt) => (
                        <AppointmentCard
                          key={apt.id}
                          appointment={apt}
                          compact
                          onClick={() => onSelectAppointment(apt)}
                        />
                      ))}
                      {dayAppointments.length === 0 && (
                        <div className="h-20 border-2 border-dashed rounded-lg flex items-center justify-center">
                          <Plus className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        {view === "day" && (
          <DayView
            date={currentDate}
            appointments={getAppointmentsForDay(currentDate)}
            onSelectAppointment={onSelectAppointment}
            onCreateAppointment={() => onCreateAppointment(currentDate)}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Day View Component
// ============================================================================

interface DayViewProps {
  date: Date;
  appointments: Appointment[];
  onSelectAppointment: (appointment: Appointment) => void;
  onCreateAppointment: () => void;
}

function DayView({ date, appointments, onSelectAppointment, onCreateAppointment }: DayViewProps) {
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const getAppointmentPosition = (apt: Appointment) => {
    const startDate = new Date(apt.startTime);
    const endDate = new Date(apt.endTime);
    const startHour = startDate.getHours() + startDate.getMinutes() / 60;
    const endHour = endDate.getHours() + endDate.getMinutes() / 60;
    const duration = endHour - startHour;
    
    return {
      top: `${(startHour / 24) * 100}%`,
      height: `${(duration / 24) * 100}%`,
    };
  };

  return (
    <div className="h-full flex">
      {/* Time labels */}
      <div className="w-16 flex-shrink-0">
        {hours.map((hour) => (
          <div
            key={hour}
            className="h-12 text-xs text-muted-foreground pr-2 text-right"
          >
            {hour.toString().padStart(2, "0")}:00
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="flex-1 relative border-l">
        {/* Hour lines */}
        {hours.map((hour) => (
          <div
            key={hour}
            className="h-12 border-t border-muted"
          />
        ))}

        {/* Appointments */}
        {appointments.map((apt) => {
          const position = getAppointmentPosition(apt);
          return (
            <div
              key={apt.id}
              className="absolute left-1 right-1 bg-primary rounded-lg p-2 text-primary-foreground cursor-pointer overflow-hidden"
              style={position}
              onClick={() => onSelectAppointment(apt)}
            >
              <div className="text-sm font-medium truncate">{apt.title}</div>
              <div className="text-xs opacity-80">
                {format(new Date(apt.startTime), "HH:mm")} - {format(new Date(apt.endTime), "HH:mm")}
              </div>
            </div>
          );
        })}

        {/* Current time indicator */}
        {isSameDay(date, new Date()) && (
          <div
            className="absolute left-0 right-0 h-0.5 bg-red-500 z-10"
            style={{
              top: `${((new Date().getHours() + new Date().getMinutes() / 60) / 24) * 100}%`,
            }}
          >
            <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-red-500" />
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Appointment Card Component
// ============================================================================

interface AppointmentCardProps {
  appointment: Appointment;
  compact?: boolean;
  onClick?: () => void;
}

export function AppointmentCard({ appointment, compact = false, onClick }: AppointmentCardProps) {
  const getStatusColor = (status: AppointmentStatus) => {
    switch (status) {
      case "confirmed": return "border-l-green-500 bg-green-500/10";
      case "pending": return "border-l-yellow-500 bg-yellow-500/10";
      case "cancelled": return "border-l-red-500 bg-red-500/10";
      case "completed": return "border-l-blue-500 bg-blue-500/10";
      default: return "border-l-gray-500";
    }
  };

  const getTypeIcon = (type: AppointmentType) => {
    switch (type) {
      case "meeting": return <Users className="h-4 w-4" />;
      case "call": return <Video className="h-4 w-4" />;
      case "event": return <Calendar className="h-4 w-4" />;
      case "reminder": return <Bell className="h-4 w-4" />;
      default: return <CalendarClock className="h-4 w-4" />;
    }
  };

  if (compact) {
    return (
      <div
        className={cn(
          "p-2 rounded-lg border-l-4 cursor-pointer hover:shadow-md transition-shadow",
          getStatusColor(appointment.status)
        )}
        onClick={onClick}
      >
        <div className="flex items-center gap-2">
          {getTypeIcon(appointment.type)}
          <span className="text-sm font-medium truncate">{appointment.title}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {format(new Date(appointment.startTime), "HH:mm")} - {format(new Date(appointment.endTime), "HH:mm")}
        </div>
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "border-l-4 cursor-pointer hover:shadow-md transition-shadow",
        getStatusColor(appointment.status)
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
              {getTypeIcon(appointment.type)}
            </div>
            <div>
              <h4 className="font-medium">{appointment.title}</h4>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-3 w-3" />
                {format(new Date(appointment.startTime), "EEE, MMM d • HH:mm")} - {format(new Date(appointment.endTime), "HH:mm")}
              </div>
            </div>
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {appointment.description && (
          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
            {appointment.description}
          </p>
        )}

        <div className="flex items-center gap-4 mt-3">
          {appointment.locationType === "virtual" ? (
            <Badge variant="secondary" className="text-xs">
              <Video className="h-3 w-3 mr-1" />
              Virtual
            </Badge>
          ) : appointment.physicalLocation && (
            <Badge variant="outline" className="text-xs">
              <MapPin className="h-3 w-3 mr-1" />
              {appointment.physicalLocation}
            </Badge>
          )}

          {appointment.recurrence && (
            <Badge variant="outline" className="text-xs">
              <Repeat className="h-3 w-3 mr-1" />
              {appointment.recurrence.frequency}
            </Badge>
          )}

          {appointment.attendees && appointment.attendees.length > 0 && (
            <div className="flex items-center gap-1">
              <div className="flex -space-x-2">
                {appointment.attendees.slice(0, 3).map((attendee, i) => (
                  <Avatar key={i} className="h-6 w-6 border-2 border-background">
                    <AvatarFallback className="text-xs">
                      {attendee.displayName?.slice(0, 1) || "?"}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
              {appointment.attendees.length > 3 && (
                <span className="text-xs text-muted-foreground">
                  +{appointment.attendees.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Appointment Details Dialog
// ============================================================================

interface AppointmentDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment;
  onEdit?: () => void;
  onDelete?: () => void;
  onJoin?: () => void;
}

export function AppointmentDetailsDialog({
  open,
  onOpenChange,
  appointment,
  onEdit,
  onDelete,
  onJoin,
}: AppointmentDetailsDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const getStatusBadge = (status: AppointmentStatus) => {
    switch (status) {
      case "confirmed":
        return <Badge className="bg-green-500">Confirmed</Badge>;
      case "pending":
        return <Badge className="bg-yellow-500">Pending</Badge>;
      case "cancelled":
        return <Badge variant="destructive">Cancelled</Badge>;
      case "completed":
        return <Badge className="bg-blue-500">Completed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>{appointment.title}</DialogTitle>
            {getStatusBadge(appointment.status)}
          </div>
          <DialogDescription>
            {appointment.description || "No description"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Date & Time */}
          <div className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">{format(new Date(appointment.startTime), "EEEE, MMMM d, yyyy")}</p>
              <p className="text-sm text-muted-foreground">
                {format(new Date(appointment.startTime), "h:mm a")} - {format(new Date(appointment.endTime), "h:mm a")}
              </p>
            </div>
          </div>

          {/* Location */}
          <div className="flex items-center gap-3">
            {appointment.locationType === "virtual" ? (
              <>
                <Video className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Virtual Meeting</p>
                  {appointment.meetingLink && (
                    <a
                      href={appointment.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline flex items-center gap-1"
                    >
                      Join meeting <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </>
            ) : (
              <>
                <MapPin className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">{appointment.physicalLocation || "No location"}</p>
                </div>
              </>
            )}
          </div>

          {/* Recurrence */}
          {appointment.recurrence && (
            <div className="flex items-center gap-3">
              <Repeat className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Recurring</p>
                <p className="text-sm text-muted-foreground capitalize">
                  {appointment.recurrence.frequency}
                </p>
              </div>
            </div>
          )}

          {/* Attendees */}
          {appointment.attendees && appointment.attendees.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-5 w-5" />
                <span className="text-sm font-medium">
                  {appointment.attendees.length} attendees
                </span>
              </div>
              <div className="space-y-2 ml-7">
                {appointment.attendees.map((attendee, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs">
                        {attendee.displayName?.slice(0, 2).toUpperCase() ||
                         attendee.walletAddress.slice(2, 4).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">
                      {attendee.displayName || attendee.walletAddress.slice(0, 10) + "..."}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {attendee.responseStatus}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reminders */}
          {appointment.reminders && appointment.reminders.length > 0 && (
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Reminders</p>
                <p className="text-sm text-muted-foreground">
                  {appointment.reminders.map((r) => `${r.minutesBefore} minutes before`).join(", ")}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {appointment.locationType === "virtual" && appointment.status === "confirmed" && (
            <Button onClick={onJoin} className="w-full sm:w-auto">
              <Video className="h-4 w-4 mr-2" />
              Join Meeting
            </Button>
          )}
          <Button variant="outline" onClick={onEdit} className="w-full sm:w-auto">
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              setIsDeleting(true);
              try {
                onDelete?.();
                onOpenChange(false);
              } finally {
                setIsDeleting(false);
              }
            }}
            disabled={isDeleting}
            className="w-full sm:w-auto"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Upcoming Appointments Widget
// ============================================================================

interface UpcomingAppointmentsProps {
  appointments: Appointment[];
  onSelectAppointment: (appointment: Appointment) => void;
  onCreateNew: () => void;
}

export function UpcomingAppointments({
  appointments,
  onSelectAppointment,
  onCreateNew,
}: UpcomingAppointmentsProps) {
  const upcomingAppointments = appointments
    .filter((apt) => isAfter(new Date(apt.startTime), new Date()) && apt.status !== "cancelled")
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Upcoming
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onCreateNew}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {upcomingAppointments.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No upcoming appointments</p>
            <Button variant="link" size="sm" onClick={onCreateNew}>
              Schedule one
            </Button>
          </div>
        ) : (
          upcomingAppointments.map((apt) => (
            <AppointmentCard
              key={apt.id}
              appointment={apt}
              compact
              onClick={() => onSelectAppointment(apt)}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default CalendarView;
