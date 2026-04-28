export const GLOBAL_SERVER_NAME = "GCChat";
export const GLOBAL_CHANNEL_NAME = "general";

export type UploadKind = "avatar" | "attachment" | "emoji";
export type UserRole = "USER" | "ADMIN" | "SUPER_ADMIN";

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
  author: UserProfile;
  attachments: AttachmentView[];
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
  attachments?: Array<{
    url: string;
    fileName: string;
    mimeType: string;
    size: number;
  }>;
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
}

export interface ServerToClientEvents {
  "message:new": (message: MessageView) => void;
  "profile:updated": (profile: UserProfile) => void;
  "members:updated": (members: ServerMemberView[]) => void;
  "channels:updated": (channels: ChannelSummary[]) => void;
  "session:banned": () => void;
  "calendar:event:upsert": (event: CalendarEventView) => void;
  "emojis:updated": (emojis: CustomEmojiView[]) => void;
}
