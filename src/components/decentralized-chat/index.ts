/**
 * Decentralized Chat Components - Index
 * Export all chat-related components for easy imports
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

// Default export - use Enhanced panel for full features
export { EnhancedDecentralizedChatPanel as default } from "./EnhancedChatPanel";
