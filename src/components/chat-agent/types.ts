import type { VideoFormat } from "@/ipc/types/video_generation";
import type {
  ChatAgentRagSource,
  ChatAgentToolPresentation,
} from "@/ipc/types/chat_agent";

/**
 * A file the user attached, kept so the sent message can still show it.
 *
 * Metadata only: conversations are persisted, and an object URL for the file
 * would be dead on the next reload. The icon is derived from the name and MIME
 * type, both of which keep working.
 */
export type ChatAgentAttachmentInfo = {
  name: string;
  mimeType: string;
  sizeBytes: number;
};

export type ChatAgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Files sent with this message, shown as cards in the bubble. */
  attachments?: ChatAgentAttachmentInfo[];
  toolResults?: ChatAgentToolResult[];
  /** Exact indexed document locations used to ground this answer. */
  ragSources?: ChatAgentRagSource[];
  artifact?: {
    title: string;
    subtitle: string;
  };
  /** Generated images (base64 data URLs) shown in a downloadable card. */
  images?: string[];
  /** The prompt that produced the media, used to name downloads. */
  mediaPrompt?: string;
  /** Model id that produced the images. */
  imageModel?: string;
  /** True while an attached document is being read by the OCR model. */
  readingDocument?: boolean;
  /** True while an image is being generated for this assistant message. */
  generatingImage?: boolean;
  /** Generated video shown inline in the conversation. */
  videoUrl?: string;
  /** Model id that produced the video. */
  videoModel?: string;
  videoFormat?: VideoFormat;
  /** True while a video is being generated. */
  generatingVideo?: boolean;
};

export type ChatAgentToolResult = {
  serverName: string;
  toolName: string;
  result: string;
  status: "running" | "completed" | "error";
  presentation?: ChatAgentToolPresentation;
};

/** A persisted Chat Agent conversation, shown in the history modal. */
export type ChatAgentConversation = {
  id: string;
  title: string;
  messages: ChatAgentMessage[];
  /** Knowledge spaces searched for every turn in this conversation. */
  vectorCollectionIds?: string[];
  updatedAt: number;
};

/** A conversation currently pinned in the Chat Agent tab strip. */
export type ChatAgentOpenTab = ChatAgentConversation;
