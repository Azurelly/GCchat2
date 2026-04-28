export const GLOBAL_SERVER_NAME = "GCChat";
export const GLOBAL_CHANNEL_NAME = "general";

export type UploadKind = "avatar" | "attachment";

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

export interface BootstrapPayload {
  user: UserProfile;
  server: ServerSummary;
  channel: ChannelSummary;
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

export interface CreateMessageRequest {
  content: string;
  attachments?: Array<{
    url: string;
    fileName: string;
    mimeType: string;
    size: number;
  }>;
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
}
