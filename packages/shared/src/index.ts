export const GLOBAL_SERVER_NAME = "GCChat";
export const GLOBAL_CHANNEL_NAME = "general";

export type UploadKind = "avatar" | "attachment" | "emoji";
export type UserRole = "USER" | "ADMIN" | "SUPER_ADMIN";
export type AuditAction =
  | "MESSAGE_DELETE"
  | "MESSAGE_RESTORE"
  | "MESSAGE_EDIT"
  | "USER_BAN"
  | "USER_UNBAN"
  | "USER_ROLE_UPDATE"
  | "CALENDAR_EVENT_DELETE"
  | "CALENDAR_EVENT_RESTORE";

export interface ApiErrorResponse {
  error: string;
  details?: unknown;
}

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  createdAt: string;
  role: UserRole;
  bannedAt: string | null;
}

export interface ServerSummary {
  id: string;
  name: string;
  iconUrl: string | null;
}

export interface ChannelSummary {
  id: string;
  serverId: string;
  name: string;
}

export interface ServerMemberView extends UserProfile {
  joinedAt: string;
  isOnline: boolean;
}

export interface AttachmentView {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface MessageView {
  id: string;
  channelId: string;
  content: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  author: UserProfile;
  attachments: AttachmentView[];
  replyTo: MessageReplyView | null;
  reactions: MessageReactionView[];
}

export interface MessageReplyView {
  id: string;
  content: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  author: UserProfile;
  attachments: AttachmentView[];
}

export interface MessageReactionView {
  emoji: string;
  count: number;
  users: UserProfile[];
}

export interface MessagePageView {
  messages: MessageView[];
  hasMore: boolean;
  nextBefore: string | null;
}

export interface YouTubeEmbedView {
  url: string;
  videoId: string;
  title: string;
  authorName: string | null;
  thumbnailUrl: string;
  embedUrl: string;
  providerName: "YouTube";
}

export interface CalendarEventOptInView {
  user: UserProfile;
  createdAt: string;
}

export interface CalendarEventView {
  id: string;
  title: string;
  description: string;
  startAt: string;
  createdAt: string;
  deletedAt: string | null;
  creator: UserProfile;
  optIns: CalendarEventOptInView[];
  viewerOptedIn: boolean;
}

export interface CustomEmojiView {
  id: string;
  name: string;
  imageUrl: string;
  useCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy: UserProfile;
}

export interface AuditLogView {
  id: string;
  action: AuditAction;
  createdAt: string;
  actor: UserProfile | null;
  targetUser: UserProfile | null;
  messageId: string | null;
  channelId: string | null;
  calendarEventId: string | null;
  metadata: unknown;
  restorable: boolean;
}

export interface BootstrapPayload {
  user: UserProfile;
  server: ServerSummary;
  channel: ChannelSummary;
  channels: ChannelSummary[];
  members: ServerMemberView[];
}

export interface AuthResponse extends BootstrapPayload {
  token: string;
}

export interface UploadResponse {
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
  kind: UploadKind;
}

export interface VoiceTokenResponse {
  token: string;
  url: string;
  roomName: string;
  identity: string;
}

export type VoiceConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

export interface VoiceParticipantState {
  userId: string;
  selfMuted: boolean;
  selfDeafened: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
  screenSharing: boolean;
  cameraOn: boolean;
  viewingStreamId: string | null;
  reconnecting: boolean;
  joinedAt: string;
  updatedAt: string;
}

export interface VoiceStateView {
  channelName: string;
  participants: VoiceParticipantState[];
}

export interface VoiceSelfStateRequest {
  selfMuted?: boolean;
  selfDeafened?: boolean;
  screenSharing?: boolean;
  cameraOn?: boolean;
  viewingStreamId?: string | null;
}

export interface VoiceModerationRequest {
  targetUserId: string;
  serverMuted?: boolean;
  serverDeafened?: boolean;
  disconnect?: boolean;
}

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface UpdateProfileRequest {
  displayName?: string;
  bio?: string;
  avatarUrl?: string | null;
}

export interface UpdateAccountRequest {
  username?: string;
  currentPassword?: string;
  newPassword?: string;
}

export interface CreateMessageRequest {
  content: string;
  replyToId?: string | null;
  attachments?: Array<{
    url: string;
    fileName: string;
    mimeType: string;
    size: number;
  }>;
}

export interface UpdateMessageRequest {
  content: string;
}

export interface ToggleMessageReactionRequest {
  emoji: string;
}

export interface CreateChannelRequest {
  name: string;
}

export interface DeleteChannelRequest {
  confirmationName: string;
}

export interface UpdateUserRoleRequest {
  role: Extract<UserRole, "USER" | "ADMIN">;
}

export interface UpdateUserBanRequest {
  banned: boolean;
}

export interface CreateCalendarEventRequest {
  title: string;
  description?: string;
  startAt: string;
}

export interface SetCalendarEventOptInRequest {
  optedIn: boolean;
}

export interface RestoreAuditLogResponse {
  auditLog: AuditLogView;
  message: MessageView | null;
  event: CalendarEventView | null;
}

export interface CreateCustomEmojiRequest {
  name: string;
  imageUrl: string;
}

export interface UpdateCustomEmojiRequest {
  name?: string;
  imageUrl?: string;
}

export interface ClientToServerEvents {
  "channel:join": (
    payload: { channelId: string },
    ack?: (response: { ok: true } | { ok: false; error: string }) => void
  ) => void;
  "message:create": (
    payload: { channelId: string } & CreateMessageRequest,
    ack?: (response: { ok: true; message: MessageView } | { ok: false; error: string }) => void
  ) => void;
  "voice:join": (
    ack?: (response: { ok: true; state: VoiceStateView } | { ok: false; error: string }) => void
  ) => void;
  "voice:leave": (ack?: (response: { ok: true } | { ok: false; error: string }) => void) => void;
  "voice:self-state": (
    payload: VoiceSelfStateRequest,
    ack?: (response: { ok: true; state: VoiceStateView } | { ok: false; error: string }) => void
  ) => void;
  "voice:moderate": (
    payload: VoiceModerationRequest,
    ack?: (response: { ok: true; state: VoiceStateView } | { ok: false; error: string }) => void
  ) => void;
}

export interface ServerToClientEvents {
  "message:new": (message: MessageView) => void;
  "message:updated": (message: MessageView) => void;
  "message:deleted": (payload: { id: string; channelId: string }) => void;
  "profile:updated": (profile: UserProfile) => void;
  "members:updated": (members: ServerMemberView[]) => void;
  "channels:updated": (channels: ChannelSummary[]) => void;
  "session:banned": () => void;
  "calendar:event:upsert": (event: CalendarEventView) => void;
  "calendar:event:deleted": (payload: { id: string }) => void;
  "audit:new": (entry: AuditLogView) => void;
  "emojis:updated": (emojis: CustomEmojiView[]) => void;
  "voice:state": (state: VoiceStateView) => void;
  "voice:moderated": (state: VoiceParticipantState) => void;
  "voice:force-disconnect": () => void;
}
