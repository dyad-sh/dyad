import { useMemo, useState } from "react";
import { Bot, Clapperboard, Download, Expand, Sparkles } from "lucide-react";
import type { ChatAgentMessage } from "./types";
import { downloadImage, downloadVideo } from "./image_download";
import { FileTypeCard } from "@/components/chat/FileTypeIcon";
import { cn } from "@/lib/utils";
import { GeneratingImageCard } from "./GeneratingImageCard";
import { DOCUMENT_STAGES, VIDEO_STAGES } from "@/lib/image_generation_stages";
import {
  ChatAgentMessageActions,
  type MessageFeedback,
} from "./ChatAgentMessageActions";
import { ChatAgentMarkdown } from "./ChatAgentMarkdown";
import { ReasoningBlock } from "./ReasoningBlock";
import { parseReasoning } from "@/lib/reasoning_blocks";
import {
  extractLocalImagePaths,
  stripLocalImagePaths,
} from "@/lib/local_image_paths";
import { LocalImageCard } from "./LocalImageCard";
import {
  NANO_BANANA_2_LABEL,
  NANO_BANANA_2_MODEL,
} from "@/ipc/types/image_generation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChatAgentResearchResultCard } from "./ChatAgentResearchResultCard";
import { ChatAgentLovableProjectCards } from "./ChatAgentLovableProjectCards";
import { ChatAgentToolResultCard } from "./ChatAgentToolResultCard";
import type { ChatAgentToolPresentation } from "@/ipc/types/chat_agent";
import { ChatAgentRagSources } from "./ChatAgentRagSources";
import { ChatAgentSocialCard } from "./ChatAgentSocialCard";
import { selectCitedRagSources } from "@/lib/rag_sources";

type LovablePresentation = Extract<
  ChatAgentToolPresentation,
  { kind: "lovable-projects" }
>;

function mergeLovableProjectPresentations(
  presentations: LovablePresentation[],
): LovablePresentation | null {
  if (presentations.length === 0) return null;
  const projectsById = new Map<
    string,
    LovablePresentation["projects"][number]
  >();
  for (const presentation of presentations) {
    for (const project of presentation.projects) {
      const merged = { ...(projectsById.get(project.id) ?? project) };
      for (const [key, value] of Object.entries(project)) {
        if (value !== undefined) Object.assign(merged, { [key]: value });
      }
      projectsById.set(project.id, merged);
    }
  }
  const projects = [...projectsById.values()];
  const latest = presentations[presentations.length - 1];
  return {
    kind: "lovable-projects",
    toolName: latest.toolName,
    heading:
      presentations.length === 1
        ? latest.heading
        : `${projects.length} Lovable project${projects.length === 1 ? "" : "s"}`,
    projects,
  };
}

function imageModelLabel(model?: string): string {
  if (!model) return "AI image";
  if (model === NANO_BANANA_2_MODEL) return NANO_BANANA_2_LABEL;
  const slug = model.split("/").pop() ?? model;
  return slug
    .replace(/-preview$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

type ChatAgentMessageRowProps = {
  message: ChatAgentMessage;
  isLastAssistant: boolean;
  isStreaming: boolean;
  feedback: MessageFeedback;
  onFeedback: (messageId: string, feedback: MessageFeedback) => void;
  onRegenerate?: () => void;
  assistantAvatar?: string;
  assistantName?: string;
};

export function ChatAgentAssistantAvatar({
  avatar,
  name = "Assistant",
}: {
  avatar?: string;
  name?: string;
}) {
  const isImage =
    avatar?.startsWith("data:image/") ||
    avatar?.startsWith("blob:") ||
    /^https?:\/\//i.test(avatar ?? "");

  return (
    <div className="chat-agent-assistant-avatar">
      {isImage ? (
        <img
          src={avatar}
          alt={`${name} avatar`}
          className="size-full object-cover"
          draggable={false}
        />
      ) : avatar ? (
        <span aria-label={`${name} avatar`} role="img">
          {avatar}
        </span>
      ) : (
        <Bot className="size-4" aria-hidden />
      )}
    </div>
  );
}

export function ChatAgentMessageRow({
  message,
  isLastAssistant,
  isStreaming,
  feedback,
  onFeedback,
  onRegenerate,
  assistantAvatar,
  assistantName,
}: ChatAgentMessageRowProps) {
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  // Pull image paths out of the reply so they render as pictures, not text.
  const localImagePaths = useMemo(
    () =>
      message.role === "assistant"
        ? extractLocalImagePaths(message.content)
        : [],
    [message.role, message.content],
  );
  const visibleContent = useMemo(
    () => stripLocalImagePaths(message.content, localImagePaths),
    [message.content, localImagePaths],
  );

  // Split a reasoning model's working out of its reply. Memoised because it
  // runs on every streamed flush.
  const reasoning = useMemo(
    () => parseReasoning(visibleContent),
    [visibleContent],
  );
  const displayedRagSources = useMemo(() => {
    const retrieved = message.ragSources ?? [];
    const answer = reasoning.reasoning ? reasoning.answer : visibleContent;
    const cited = selectCitedRagSources(answer, retrieved);
    if (cited.length > 0) return cited;
    // Citations usually arrive at the end of a streamed answer. Avoid briefly
    // showing every retrieval candidate before that final list is written.
    return isStreaming && isLastAssistant ? [] : retrieved;
  }, [
    isLastAssistant,
    isStreaming,
    message.ragSources,
    reasoning.answer,
    reasoning.reasoning,
    visibleContent,
  ]);

  if (message.role === "user") {
    return (
      <article
        className="chat-agent-turn chat-agent-turn--user"
        data-testid="chat-agent-message-user"
      >
        <div className="chat-agent-user-bubble chat-card-fly-in">
          <p className="chat-agent-message-text">{message.content}</p>
          {/* Files sent for OCR or reading show as themselves, not as a line
              of text buried in the prompt. */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="chat-file-card-grid">
              {message.attachments.map((attachment, index) => (
                <FileTypeCard
                  key={`${attachment.name}-${index}`}
                  fileName={attachment.name}
                  mimeType={attachment.mimeType}
                  sizeBytes={attachment.sizeBytes}
                />
              ))}
            </div>
          )}
        </div>
      </article>
    );
  }

  const showActions = !isStreaming || !isLastAssistant;
  // Whatever this reply produced, the actions row is where you save it.
  const firstImage = message.images?.[0];
  // The prompt names the file: a media-only reply usually has no text of its
  // own to name it with.
  const mediaName = message.mediaPrompt || message.content;
  const downloadMedia = message.videoUrl
    ? () => void downloadVideo(message.videoUrl!, mediaName)
    : firstImage
      ? () => void downloadImage(firstImage, mediaName)
      : undefined;
  const lovablePresentations =
    message.toolResults?.flatMap((result) =>
      result.presentation?.kind === "lovable-projects"
        ? [result.presentation]
        : [],
    ) ?? [];
  const mergedLovablePresentation =
    mergeLovableProjectPresentations(lovablePresentations);
  const firstLovableResultIndex =
    message.toolResults?.findIndex(
      (result) => result.presentation?.kind === "lovable-projects",
    ) ?? -1;

  return (
    <article
      className="chat-agent-turn chat-agent-turn--assistant"
      data-testid="chat-agent-message-assistant"
    >
      <ChatAgentAssistantAvatar avatar={assistantAvatar} name={assistantName} />
      <div className="chat-agent-assistant-content">
        {/* Tool results come before the prose because that is the order they
            happened in: the search runs, then the answer is written about it.
            Rendering them after meant every streamed token pushed the cards
            further down the page. */}
        {message.toolResults && message.toolResults.length > 0 && (
          <div className="chat-agent-tool-results">
            {message.toolResults.map((result, index) =>
              result.presentation ? (
                result.presentation.kind === "lovable-projects" ? (
                  index === firstLovableResultIndex &&
                  mergedLovablePresentation ? (
                    <ChatAgentLovableProjectCards
                      key="lovable-projects"
                      presentation={mergedLovablePresentation}
                    />
                  ) : null
                ) : result.presentation.kind === "x-profile" ||
                  result.presentation.kind === "x-post-composer" ? (
                  <ChatAgentSocialCard
                    key={`${result.serverName}-${result.toolName}-${index}`}
                    presentation={result.presentation}
                  />
                ) : (
                  <ChatAgentResearchResultCard
                    key={`${result.serverName}-${result.toolName}-${index}`}
                    presentation={result.presentation}
                  />
                )
              ) : (
                <ChatAgentToolResultCard
                  key={`${result.serverName}-${result.toolName}-${index}`}
                  result={result}
                />
              ),
            )}
          </div>
        )}

        {/* The glass surface is for prose. A reply that is only an image or a
            generation card already has its own card, and wrapping that in a
            second panel just puts a rectangle behind it. */}
        <div
          className={cn(
            "chat-agent-assistant-body",
            visibleContent && "chat-agent-assistant-body--glass",
            visibleContent && "chat-card-fly-in",
            // New blocks fade in only while this reply is being written;
            // finished conversations render instantly.
            isStreaming && isLastAssistant && "chat-streaming-body",
          )}
        >
          {visibleContent ? (
            <>
              {/* A reasoning model's working is split out so it cannot be
                  mistaken for the answer. */}
              {reasoning.reasoning && (
                <ReasoningBlock
                  reasoning={reasoning.reasoning}
                  // "Thinking…" only while the reply is genuinely still
                  // arriving. An unclosed tag on a finished message means the
                  // model stopped, not that it is still working.
                  streaming={
                    reasoning.streaming && isStreaming && isLastAssistant
                  }
                />
              )}
              {/* Never fall back to the raw text: when a block is open, the raw
                  text still holds the tag and the working, and showing it
                  would print the reasoning twice. */}
              {reasoning.answer ? (
                <ChatAgentMarkdown content={reasoning.answer} />
              ) : (
                reasoning.reasoning &&
                !(isStreaming && isLastAssistant) && (
                  // The model spent its whole token budget thinking and never
                  // reached an answer. Saying so beats presenting the working
                  // as though it were the reply.
                  <p className="chat-reasoning-truncated">
                    The model ran out of room while thinking and did not reach
                    an answer. Open the thought process above, or raise the
                    response length for this model in Settings.
                  </p>
                )
              )}
              {/* A glowing block while text is still arriving, so a pause
                  reads as thinking rather than as a finished answer. */}
              {isStreaming && isLastAssistant && (
                <span className="chat-stream-cursor" aria-hidden />
              )}
            </>
          ) : null}

          {/* Agents that write images to disk answer with a path; show the
              picture rather than the path. */}
          {localImagePaths.length > 0 && (
            <div className="chat-agent-image-grid">
              {localImagePaths.map((imagePath) => (
                <LocalImageCard
                  key={imagePath}
                  path={imagePath}
                  onPreview={setPreviewImage}
                />
              ))}
            </div>
          )}

          {message.readingDocument && (
            <GeneratingImageCard
              label="Reading document"
              stages={DOCUMENT_STAGES}
            />
          )}

          {message.generatingImage && <GeneratingImageCard />}

          {message.images && message.images.length > 0 && (
            <div className="chat-agent-image-grid">
              {message.images.map((image, index) => (
                <figure
                  key={index}
                  className="chat-agent-image-card chat-card-fly-in"
                >
                  <button
                    type="button"
                    className="chat-agent-image-preview-trigger"
                    onClick={() => setPreviewImage(image)}
                    aria-label={`Preview generated image ${index + 1}`}
                  >
                    <img
                      src={image}
                      alt={message.content || "Generated image"}
                      className="chat-agent-image"
                    />
                    <span className="chat-agent-image-preview-hint">
                      <Expand className="size-4" />
                      Preview
                    </span>
                  </button>
                  <figcaption className="chat-agent-image-card-footer">
                    <span className="chat-agent-image-model">
                      <Sparkles className="size-3.5" />
                      {imageModelLabel(message.imageModel)}
                    </span>
                    <button
                      type="button"
                      className="chat-agent-image-download"
                      onClick={() => void downloadImage(image, mediaName)}
                    >
                      <Download className="size-3.5" />
                      Download
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}

          {message.generatingVideo && (
            <GeneratingImageCard
              label="Generating video"
              stages={VIDEO_STAGES}
              footnote="Video takes a few minutes. It times out after 10."
            />
          )}

          {message.videoUrl && (
            <figure className="chat-card-fly-in mt-3 w-full max-w-[320px] overflow-hidden rounded-2xl border border-cyan-400/20 bg-black shadow-[0_0_28px_rgba(0,229,255,0.08)]">
              <video
                src={message.videoUrl}
                controls
                playsInline
                preload="metadata"
                className="block w-full"
                style={{ aspectRatio: "9 / 16" }}
              />
              <figcaption className="flex items-center gap-1.5 border-t border-cyan-400/15 bg-[#061225] px-3 py-2 text-xs text-cyan-100/55">
                <Clapperboard className="size-3.5 shrink-0 text-cyan-300" />
                <span className="min-w-0 truncate">
                  {message.videoModel || "AI video"}
                </span>
              </figcaption>
            </figure>
          )}

          <Dialog
            open={previewImage !== null}
            onOpenChange={(open) => {
              if (!open) setPreviewImage(null);
            }}
          >
            <DialogContent className="max-h-[94vh] w-auto max-w-[94vw] gap-3 overflow-hidden border-cyan-400/25 bg-[#030a14]/98 p-3 shadow-[0_0_60px_rgba(0,229,255,0.18)] sm:max-w-[94vw]">
              <DialogHeader className="sr-only">
                <DialogTitle>Generated image preview</DialogTitle>
                <DialogDescription>
                  Full-size preview of the generated image
                </DialogDescription>
              </DialogHeader>
              {previewImage && (
                <>
                  <img
                    src={previewImage}
                    alt={message.content || "Generated image preview"}
                    className="max-h-[82vh] max-w-[90vw] rounded-lg object-contain"
                  />
                  <div className="flex items-center justify-between gap-3 px-1">
                    <span className="truncate text-xs text-cyan-100/55">
                      {imageModelLabel(message.imageModel)}
                    </span>
                    <button
                      type="button"
                      className="chat-agent-image-download"
                      onClick={() =>
                        void downloadImage(previewImage, mediaName)
                      }
                    >
                      <Download className="size-3.5" />
                      Download
                    </button>
                  </div>
                </>
              )}
            </DialogContent>
          </Dialog>

          {message.artifact && (
            <button
              type="button"
              className="chat-agent-artifact chat-card-fly-in"
              onClick={() => undefined}
            >
              <div className="chat-agent-artifact-text">
                <span className="chat-agent-artifact-title">
                  {message.artifact.title}
                </span>
                <span className="chat-agent-artifact-sub">
                  {message.artifact.subtitle}
                </span>
              </div>
              <span className="chat-agent-artifact-icon" aria-hidden>
                <Sparkles className="size-5" />
              </span>
            </button>
          )}
        </div>
        {displayedRagSources.length > 0 && (
          <ChatAgentRagSources sources={displayedRagSources} />
        )}
        {showActions && (
          <ChatAgentMessageActions
            messageId={message.id}
            content={message.content}
            isLastAssistant={isLastAssistant}
            isStreaming={isStreaming && isLastAssistant}
            feedback={feedback}
            onFeedback={onFeedback}
            onRegenerate={isLastAssistant ? onRegenerate : undefined}
            onDownload={downloadMedia}
          />
        )}
      </div>
    </article>
  );
}
