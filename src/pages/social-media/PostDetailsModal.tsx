import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  CalendarClock,
  ExternalLink,
  Loader2,
  Send,
  Trash2,
} from "lucide-react";

import {
  SOCIAL_PLATFORM_META,
  SocialPlatformIcon,
} from "@/components/social/social-platform-meta";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSocialPosts } from "@/hooks/useSocialMedia";
import type { SocialPost } from "@/ipc/types/social_media";
import { showError, showSuccess } from "@/lib/toast";
import { PostStatusBadge } from "./post-meta";

/**
 * Planner entry details: review the copy and image, reschedule drafts and
 * scheduled posts, publish immediately, delete, or jump to the live post.
 */
export function PostDetailsModal({
  post,
  open,
  onOpenChange,
}: {
  post: SocialPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { updatePost, deletePost, publishPost } = useSocialPosts();
  const [busy, setBusy] = useState<"publish" | "reschedule" | "delete" | null>(
    null,
  );
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");

  useEffect(() => {
    if (!open || !post) return;
    setBusy(null);
    const base = post.scheduledFor ?? Date.now();
    setScheduleDate(format(base, "yyyy-MM-dd"));
    setScheduleTime(format(base, "HH:mm"));
  }, [open, post]);

  if (!post) return null;

  const meta = SOCIAL_PLATFORM_META[post.platform];
  const isEditable = post.status !== "posted" && post.status !== "posting";

  const handlePublishNow = async () => {
    setBusy("publish");
    try {
      await publishPost(post.id);
      showSuccess(`Published to ${meta.label}`);
      onOpenChange(false);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  };

  const handleReschedule = async () => {
    const ts = new Date(`${scheduleDate}T${scheduleTime}`).getTime();
    if (Number.isNaN(ts) || ts <= Date.now()) {
      showError("Pick a future date and time.");
      return;
    }
    setBusy("reschedule");
    try {
      await updatePost({ id: post.id, scheduledFor: ts, status: "scheduled" });
      showSuccess(`Scheduled for ${format(ts, "MMM d 'at' HH:mm")}`);
      onOpenChange(false);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    setBusy("delete");
    try {
      await deletePost(post.id);
      showSuccess("Removed from the planner");
      onOpenChange(false);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span
              className={`grid size-9 place-items-center rounded-xl border ${meta.iconWrapClass}`}
            >
              <SocialPlatformIcon platform={post.platform} className="size-4" />
            </span>
            {meta.label} post
            <PostStatusBadge status={post.status} className="ml-auto" />
          </DialogTitle>
          <DialogDescription>
            {post.status === "posted" && post.postedAt
              ? `Published ${format(post.postedAt, "MMM d, yyyy 'at' HH:mm")}`
              : post.status === "scheduled" && post.scheduledFor
                ? `Scheduled for ${format(post.scheduledFor, "MMM d, yyyy 'at' HH:mm")}`
                : `Created ${format(post.createdAt, "MMM d, yyyy 'at' HH:mm")}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-3 text-sm leading-relaxed text-white/90">
            {post.content}
          </p>

          {post.image && (
            <img
              src={post.image}
              alt="Post visual"
              className="max-h-72 w-full rounded-xl border border-white/10 object-cover"
            />
          )}

          {post.prompt && (
            <p className="text-[11px] text-white/35">
              Generated from: “{post.prompt}”
            </p>
          )}

          {post.status === "failed" && post.error && (
            <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {post.error}
            </p>
          )}

          {isEditable && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-white/50">
                <CalendarClock className="size-3.5" />
                {post.status === "scheduled" ? "Reschedule" : "Schedule"}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="w-40"
                />
                <Input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-28"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReschedule}
                  disabled={busy != null}
                >
                  {busy === "reschedule" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CalendarClock className="size-3.5" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="ghost"
              className="text-rose-300 hover:text-rose-200"
              onClick={handleDelete}
              disabled={busy != null}
            >
              {busy === "delete" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete
            </Button>
            <div className="ml-auto flex items-center gap-2">
              {post.externalUrl && (
                <Button
                  variant="outline"
                  as="a"
                  href={post.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-4" />
                  View on {meta.label}
                </Button>
              )}
              {isEditable && (
                <Button onClick={handlePublishNow} disabled={busy != null}>
                  {busy === "publish" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  Post now
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
