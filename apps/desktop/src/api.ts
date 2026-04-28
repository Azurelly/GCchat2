import type {
  AuthResponse,
  AuditLogView,
  BootstrapPayload,
  CalendarEventView,
  ChannelSummary,
  CustomEmojiView,
  CreateChannelRequest,
  CreateCalendarEventRequest,
  CreateCustomEmojiRequest,
  CreateMessageRequest,
  DeleteChannelRequest,
  MessageView,
  RestoreAuditLogResponse,
  SetCalendarEventOptInRequest,
  ToggleMessageReactionRequest,
  UpdateMessageRequest,
  UpdateAccountRequest,
  UpdateCustomEmojiRequest,
  UpdateUserBanRequest,
  UpdateProfileRequest,
  UpdateUserRoleRequest,
  UploadKind,
  UploadResponse,
  UserProfile,
  VoiceTokenResponse
} from "@gcchat/shared";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4197";

export class ApiClient {
  private token: string | null = null;

  public setToken(token: string | null) {
    this.token = token;
  }

  public register(username: string, password: string) {
    return this.request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
  }

  public login(username: string, password: string) {
    return this.request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
  }

  public me() {
    return this.request<BootstrapPayload>("/me");
  }

  public updateProfile(input: UpdateProfileRequest) {
    return this.request<UserProfile>("/me/profile", {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  public updateAccount(input: UpdateAccountRequest) {
    return this.request<UserProfile>("/me/account", {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  public getProfile(userId: string) {
    return this.request<UserProfile>(`/users/${userId}/profile`);
  }

  public getMessages(channelId: string) {
    return this.request<MessageView[]>(`/channels/${channelId}/messages`);
  }

  public createChannel(input: CreateChannelRequest) {
    return this.request<ChannelSummary>("/channels", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  public deleteChannel(channelId: string, input: DeleteChannelRequest) {
    return this.request<ChannelSummary[]>(`/channels/${channelId}`, {
      method: "DELETE",
      body: JSON.stringify(input)
    });
  }

  public updateUserRole(userId: string, input: UpdateUserRoleRequest) {
    return this.request<UserProfile>(`/users/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  public updateUserBan(userId: string, input: UpdateUserBanRequest) {
    return this.request<UserProfile>(`/users/${userId}/ban`, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  public createMessage(channelId: string, input: CreateMessageRequest) {
    return this.request<MessageView>(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  public updateMessage(messageId: string, input: UpdateMessageRequest) {
    return this.request<MessageView>(`/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  public deleteMessage(messageId: string) {
    return this.request<{ id: string; channelId: string }>(`/messages/${messageId}`, {
      method: "DELETE"
    });
  }

  public toggleMessageReaction(messageId: string, input: ToggleMessageReactionRequest) {
    return this.request<MessageView>(`/messages/${messageId}/reactions`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  public createVoiceToken() {
    return this.request<VoiceTokenResponse>("/voice/token", {
      method: "POST",
      body: JSON.stringify({})
    });
  }

  public getCalendarEvents() {
    return this.request<CalendarEventView[]>("/calendar/events");
  }

  public createCalendarEvent(input: CreateCalendarEventRequest) {
    return this.request<CalendarEventView>("/calendar/events", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  public setCalendarEventOptIn(eventId: string, input: SetCalendarEventOptInRequest) {
    return this.request<CalendarEventView>(`/calendar/events/${eventId}/opt-in`, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  public deleteCalendarEvent(eventId: string) {
    return this.request<{ id: string }>(`/calendar/events/${eventId}`, {
      method: "DELETE"
    });
  }

  public getAuditLogs() {
    return this.request<AuditLogView[]>("/audit");
  }

  public restoreAuditLogEntry(logId: string) {
    return this.request<RestoreAuditLogResponse>(`/audit/${logId}/restore`, {
      method: "POST"
    });
  }

  public getCustomEmojis() {
    return this.request<CustomEmojiView[]>("/emojis");
  }

  public createCustomEmoji(input: CreateCustomEmojiRequest) {
    return this.request<CustomEmojiView>("/emojis", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  public updateCustomEmoji(emojiId: string, input: UpdateCustomEmojiRequest) {
    return this.request<CustomEmojiView>(`/emojis/${emojiId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  public deleteCustomEmoji(emojiId: string) {
    return this.request<CustomEmojiView[]>(`/emojis/${emojiId}`, {
      method: "DELETE"
    });
  }

  public async upload(file: File, kind: UploadKind) {
    const form = new FormData();
    form.set("file", file);
    form.set("kind", kind);

    return this.request<UploadResponse>("/uploads", {
      method: "POST",
      body: form,
      skipJsonContentType: true
    });
  }

  private async request<T>(path: string, options: RequestInit & { skipJsonContentType?: boolean } = {}) {
    const headers = new Headers(options.headers);

    if (!options.skipJsonContentType) {
      headers.set("content-type", "application/json");
    }

    if (this.token) {
      headers.set("authorization", `Bearer ${this.token}`);
    }

    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        body && typeof body === "object" && "error" in body
          ? String(body.error)
          : "Request failed";
      throw new Error(message);
    }

    return body as T;
  }
}
