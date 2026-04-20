/**
 * Decentralized Chat Components - Index
 * Export all chat-related components for easy imports
 * 
 * EXHAUSTIVE P2P CHAT SYSTEM:
 * - E2E encrypted DMs (human↔human, human↔agent, agent↔agent)
 * - Group chats with roles/permissions
 * - Community Spaces with channels (Discord/Slack-style)
 * - Threads (nested conversations)
 * - AI Agent/Bot framework (first-class participants)
 * - WebRTC video/audio calls & meetings
 * - Voice messages with transcription
 * - Stories/Status updates
 * - Polls, Payments, Bookmarks
 * - Message search, forwarding, pinning
 * - Smart notifications
 * - NFT/Token gating
 * - Auto-moderation & anti-spam AI
 */

// Main chat panel (original)
export { 
  DecentralizedChatPanel,
  IdentitySetupDialog,
  NewConversationDialog,
  ConversationListItem,
  MessageBubble,
  ChatWindow,
} from "./DecentralizedChatPanel";

// Enhanced chat panel with WebRTC, groups, meetings, appointments
export { 
  EnhancedDecentralizedChatPanel,
} from "./EnhancedChatPanel";

// Meeting/Video call components
export {
  MeetingRoom,
  MeetingControls,
  VideoTile,
  CreateMeetingDialog,
  JoinMeetingDialog,
} from "./MeetingComponents";

// Group chat components
export {
  CreateGroupDialog,
  GroupSettingsDialog,
  GroupCard,
  GroupInviteDialog,
} from "./GroupComponents";

// Appointment/Calendar components
export {
  CreateAppointmentDialog,
  CalendarView,
  AppointmentCard,
  AppointmentDetailsDialog,
  UpcomingAppointments,
} from "./AppointmentComponents";

// Channel & Community components
export {
  CreateChannelDialog,
  ChannelItem,
  CategoryGroup,
  CommunitySidebar,
  ThreadListPanel,
  CommunitySettingsDialog,
  MemberListPanel,
  CreateCommunityDialog,
} from "./ChannelComponents";

// Bot & AI Agent components
export {
  BotCard,
  BotDetailDialog,
  BotMarketplace,
  BotInteractionLog,
  CommandPalette,
  CreateBotDialog,
} from "./BotComponents";

// Feature components (Voice, Search, Stories, Payments, etc.)
export {
  VoiceRecorder,
  VoiceMessagePlayer,
  MessageSearchPanel,
  BookmarksPanel,
  ForwardDialog,
  CreatePollDialog,
  PollDisplay,
  StoryBar,
  StoryViewer,
  PaymentCard,
  PinnedMessagesPanel,
  LinkPreviewCard,
  NotificationCenter,
  MessageActions,
} from "./FeatureComponents";

// Default export - use Enhanced panel for full features
export { EnhancedDecentralizedChatPanel as default } from "./EnhancedChatPanel";
