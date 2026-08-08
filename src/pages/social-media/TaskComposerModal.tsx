import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Check, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PlannerTask, PlannerTaskPriority } from "@/lib/planner_tasks";
import { showError } from "@/lib/toast";

export function TaskComposerModal({
  open,
  task,
  initialDate,
  onOpenChange,
  onSave,
  onDelete,
}: {
  open: boolean;
  task: PlannerTask | null;
  initialDate: Date;
  onOpenChange: (open: boolean) => void;
  onSave: (task: PlannerTask) => void;
  onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [priority, setPriority] = useState<PlannerTaskPriority>("medium");

  useEffect(() => {
    if (!open) return;
    const dueAt = task?.dueAt ?? initialDate.getTime();
    setTitle(task?.title ?? "");
    setNotes(task?.notes ?? "");
    setDate(format(dueAt, "yyyy-MM-dd"));
    setTime(task ? format(dueAt, "HH:mm") : "09:00");
    setPriority(task?.priority ?? "medium");
  }, [initialDate, open, task]);

  const save = () => {
    const dueAt = new Date(`${date}T${time}`).getTime();
    if (!title.trim()) {
      showError("Add a task title.");
      return;
    }
    if (Number.isNaN(dueAt)) {
      showError("Choose a valid date and time.");
      return;
    }
    const now = Date.now();
    onSave({
      id: task?.id ?? crypto.randomUUID(),
      title: title.trim(),
      notes: notes.trim(),
      dueAt,
      priority,
      completed: task?.completed ?? false,
      createdAt: task?.createdAt ?? now,
      updatedAt: now,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-cyan-400/20 bg-[#061225] text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription className="text-cyan-100/45">
            Add any reminder, deadline, appointment or custom task to your
            planner.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="planner-task-title">Task</Label>
            <Input
              id="planner-task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Prepare the launch brief"
              autoFocus
              data-testid="planner-task-title"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="planner-task-notes">Notes</Label>
            <textarea
              id="planner-task-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional details…"
              rows={4}
              className="flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_8rem_9rem]">
            <div className="space-y-1.5">
              <Label htmlFor="planner-task-date">Date</Label>
              <Input
                id="planner-task-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planner-task-time">Time</Label>
              <Input
                id="planner-task-time"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(value) => {
                  if (value) setPriority(value as PlannerTaskPriority);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row items-center">
          {task && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-rose-300"
              onClick={() => {
                onDelete(task.id);
                onOpenChange(false);
              }}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={save} data-testid="planner-task-save">
            <Check className="size-4" />
            Save task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
