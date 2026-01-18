# Testing Enhanced Decentralized Chat with WebRTC

## What's New 🎉

Your decentralized chat now includes:
- **WebRTC Video Calls** - Start video/audio calls directly from any conversation
- **Group Chats** - Create and manage group conversations with advanced permissions
- **Meetings** - Schedule and host virtual meetings with recording capabilities
- **Appointments** - Calendar system for scheduling meetings with reminders and recurrence

## How to Access

1. **Open JoyCreate** (should be running now)
2. **Click "P2P Chat"** in the left sidebar (under the "Share" section)
3. You'll see the **Enhanced Chat Panel** with:
   - Navigation sidebar on the left (Chats, Groups, Meetings, Calendar tabs)
   - Chat list in the middle
   - Active conversation on the right

## Features to Test

### 1. Navigation Sidebar (Left Edge)
Click the icons to switch between:
- **Chats** 💬 - Your direct conversations
- **Groups** 👥 - Group conversations
- **Meetings** 📹 - Live and scheduled meetings
- **Calendar** 📅 - Appointment scheduling

### 2. Video/Audio Calls
**From any active conversation:**
- Click the **video camera icon** (📹) in the header to start a video call
- Click the **phone icon** (📞) to start an audio-only call
- You'll see a "Join Meeting" dialog
- Toggle audio/video on/off before joining

**Meeting Controls:**
- Mic on/off
- Camera on/off
- Screen share
- End call
- Chat (side panel)
- Participants list
- Settings (video quality, layout)

### 3. Create a Group
1. Click the **"Groups"** tab in the navigation sidebar
2. Click **"+ New Group"** button
3. Fill in:
   - Group name
   - Description
   - Avatar/image
   - Privacy settings (Public/Private)
   - Invite members by wallet address

**Group Features:**
- Member management with roles (Admin, Moderator, Member)
- Custom permissions per role
- Group invite links
- Rich settings panel

### 4. Schedule a Meeting
1. Click the **"Meetings"** tab
2. Click **"+ New Meeting"** button
3. Choose:
   - **Instant** - Start now
   - **Scheduled** - Pick date/time
   - **Recurring** - Set up repeating meetings
4. Configure settings:
   - Enable waiting room
   - Auto-record
   - Max participants
   - Password protection

### 5. Create an Appointment
1. Click the **"Calendar"** tab
2. Click **"+ New"** button (or click any date)
3. Set up:
   - Title and description
   - Date and time
   - Location (virtual or physical)
   - Recurrence pattern (daily, weekly, monthly)
   - Attendees
   - Reminders

**Calendar Views:**
- Month view (default)
- Week view
- Day view
- Upcoming appointments sidebar

## Testing Checklist

- [ ] Navigate to P2P Chat from sidebar
- [ ] See the new enhanced interface
- [ ] Create a new 1-on-1 conversation
- [ ] **Run Self-Test** (click your identity dropdown → "Run Self-Test")
- [ ] Start a video call from a conversation
- [ ] Toggle audio/video during call
- [ ] Create a new group
- [ ] Add members to group
- [ ] Schedule a future meeting
- [ ] Create an appointment
- [ ] View calendar in different modes (month/week/day)
- [ ] Check groups list
- [ ] Check meetings list (live/upcoming/recent)

## Self-Test Feature 🔒

The new **Self-Test** dialog verifies your decentralized chat setup:

1. Click your **identity card** (top of chat panel) 
2. Click the dropdown arrow next to your name
3. Select **"Run Self-Test"**

The test checks:
| Test | What it Verifies |
|------|------------------|
| **Encryption Keys** | Your X25519 + Ed25519 keys are properly generated |
| **Self-Encryption** | Messages can be encrypted/decrypted (x25519-xsalsa20-poly1305) |
| **IPFS Status** | Helia node is running and connected |
| **CID Pinning** | Data can be pinned with minimal footprint |
| **Video/Audio** | Camera and microphone are accessible |
| **P2P Connectivity** | Pubsub is ready for messaging |

All tests should show ✅ green checkmarks for full functionality.

## Notes

- **Identity Setup**: On first use, you'll be prompted to set up your chat identity (wallet connection)
- **WebRTC**: Video/audio calls use WebRTC peer-to-peer connections via `simple-peer`
- **IPFS**: Messages are stored on IPFS/Helia for decentralization
- **Encryption**: All messages are end-to-end encrypted using **TweetNaCl** (x25519-xsalsa20-poly1305)
- **Minimal Footprint**: Only small CID pins are stored - messages are truly private
- **Self-Test**: Run the built-in self-test to verify your encryption and connectivity

## Architecture

- **Frontend**: React components in `src/components/decentralized-chat/`
  - `EnhancedChatPanel.tsx` - Main panel with navigation
  - `MeetingComponents.tsx` - Video call UI
  - `GroupComponents.tsx` - Group management
  - `AppointmentComponents.tsx` - Calendar/scheduling
  
- **Hooks**: 
  - `useDecentralizedChat.ts` - Chat state management
  - `useMeetingService.ts` - WebRTC meeting service
  
- **Types**: `src/types/decentralized_chat_types.ts`

## Known Limitations

- Mock data for now - groups, meetings, appointments need backend integration
- WebRTC signaling needs to be connected to the P2P network
- Recording feature UI only - needs actual recording implementation
- Calendar component simplified (no full calendar widget yet)

## Next Steps

To make this production-ready:
1. Integrate with actual IPFS/Helia backend
2. Connect WebRTC signaling to libp2p pubsub
3. Implement meeting recording
4. Add calendar persistence
5. Implement group invitations via blockchain
6. Add push notifications for meetings/appointments
