import type {
  BootstrapPayload,
  CalendarEventView,
  ChannelSummary,
  CreateCalendarEventRequest,
  CreateMessageRequest,
  MessageView,
  SetCalendarEventOptInRequest,
  ServerMemberView,
  ServerSummary,
  UpdateProfileRequest,
  UserProfile
} from "@gcchat/shared";

export interface UserAuthRecord {
  id: string;
  username: string;
  passwordHash: string;
}

export interface GlobalCommunity {
  server: ServerSummary;
  channel: ChannelSummary;
}

export interface ChatRepository {
  ensureGlobalCommunity(): Promise<GlobalCommunity>;
  createUser(input: { username: string; passwordHash: string }): Promise<UserProfile>;
  findUserAuthByUsername(username: string): Promise<UserAuthRecord | null>;
  getBootstrap(userId: string): Promise<BootstrapPayload>;
  getProfile(userId: string): Promise<UserProfile | null>;
  updateProfile(userId: string, input: UpdateProfileRequest): Promise<UserProfile>;
  listServerMembers(serverId: string): Promise<ServerMemberView[]>;
  userHasServerAccess(userId: string, serverId: string): Promise<boolean>;
  userHasChannelAccess(userId: string, channelId: string): Promise<boolean>;
  listMessages(channelId: string, limit: number): Promise<MessageView[]>;
  createMessage(
    input: { channelId: string; authorId: string } & CreateMessageRequest
  ): Promise<MessageView>;
  listCalendarEvents(viewerId: string): Promise<CalendarEventView[]>;
  createCalendarEvent(
    input: { creatorId: string } & CreateCalendarEventRequest
  ): Promise<CalendarEventView>;
  setCalendarEventOptIn(
    userId: string,
    eventId: string,
    input: SetCalendarEventOptInRequest
  ): Promise<CalendarEventView>;
}
