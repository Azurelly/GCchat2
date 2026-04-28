import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  Download,
  Hash,
  ImagePlus,
  Loader2,
  LogOut,
  MessageCircle,
  Send,
  Settings,
  Sparkles,
  Upload,
  X
} from "lucide-react";
import { io, type Socket } from "socket.io-client";
import type {
  AuthResponse,
  BootstrapPayload,
  CreateMessageRequest,
  MessageView,
  ServerMemberView,
  ServerToClientEvents,
  ClientToServerEvents,
  UserProfile
} from "@gcchat/shared";
import { API_URL, ApiClient } from "./api";

const tokenStorageKey = "gcchat.token";

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Session extends BootstrapPayload {
  token: string;
}

const api = new ApiClient();

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    phase: "idle",
    canRestart: false
  });
  const socketRef = useRef<ChatSocket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem(tokenStorageKey);

    if (!token) {
      setLoading(false);
      return;
    }

    api.setToken(token);
    api
      .me()
      .then((bootstrap) => setSession({ ...bootstrap, token }))
      .catch(() => {
        localStorage.removeItem(tokenStorageKey);
        api.setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void window.gcchat.updates.getStatus().then(setUpdateStatus);
    const unsubscribe = window.gcchat.updates.onStatus(setUpdateStatus);

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!session) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setMessages([]);
      return;
    }

    api.setToken(session.token);
    let active = true;

    api
      .getMessages(session.channel.id)
      .then((history) => {
        if (active) {
          setMessages(history);
        }
      })
      .catch((requestError) => setError(getMessage(requestError)));

    const socket: ChatSocket = io(API_URL, {
      auth: { token: session.token },
      transports: ["websocket", "polling"]
    });

    socket.on("connect", () => {
      socket.emit("channel:join", { channelId: session.channel.id });
    });

    socket.on("message:new", (message) => {
      setMessages((current) => {
        if (current.some((existing) => existing.id === message.id)) {
          return current;
        }

        return [...current, message];
      });
    });

    socket.on("profile:updated", (profile) => {
      setSession((current) => (current ? applyProfileUpdate(current, profile) : current));
      setMessages((current) =>
        current.map((message) =>
          message.author.id === profile.id ? { ...message, author: profile } : message
        )
      );
      setSelectedProfile((current) => (current?.id === profile.id ? profile : current));
    });

    socket.on("members:updated", (members) => {
      setSession((current) => (current ? { ...current, members } : current));
    });

    socket.on("connect_error", (socketError) => setError(socketError.message));
    socketRef.current = socket;

    return () => {
      active = false;
      socket.disconnect();
    };
  }, [session?.token, session?.channel.id]);

  const handleAuth = (auth: AuthResponse) => {
    localStorage.setItem(tokenStorageKey, auth.token);
    api.setToken(auth.token);
    setSession(auth);
    setError(null);
  };

  const handleLogout = () => {
    localStorage.removeItem(tokenStorageKey);
    api.setToken(null);
    socketRef.current?.disconnect();
    setSession(null);
    setSelectedProfile(null);
    setSettingsOpen(false);
  };

  const handleProfileSaved = (profile: UserProfile) => {
    setSession((current) => (current ? applyProfileUpdate(current, profile) : current));
    setSettingsOpen(false);
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <Loader2 className="spin" size={28} />
      </div>
    );
  }

  if (!session) {
    return <AuthScreen onAuth={handleAuth} />;
  }

  return (
    <div className="app-shell">
      <aside className="server-rail">
        <button className="server-pill active" aria-label={session.server.name}>
          <MessageCircle size={25} />
        </button>
      </aside>

      <aside className="channel-sidebar">
        <div className="server-header">
          <span>{session.server.name}</span>
          <Sparkles size={16} />
        </div>

        <div className="channel-group">
          <div className="channel-group-title">Text Channels</div>
          <button className="channel-link active">
            <Hash size={18} />
            {session.channel.name}
          </button>
        </div>

        <div className="user-panel">
          <button className="user-identity" onClick={() => setSelectedProfile(session.user)}>
            <Avatar profile={session.user} size="sm" />
            <span>
              <strong>{session.user.displayName}</strong>
              <small>@{session.user.username}</small>
            </span>
          </button>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            <Settings size={18} />
          </button>
          <button className="icon-button" onClick={handleLogout} aria-label="Log out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div className="chat-title">
            <Hash size={22} />
            <span>{session.channel.name}</span>
          </div>
          <UpdateButton status={updateStatus} />
        </header>

        {error ? (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        ) : null}

        <MessageList messages={messages} onProfile={setSelectedProfile} />
        <Composer
          channelId={session.channel.id}
          socket={socketRef.current}
          onError={setError}
          onFallbackMessage={(message) =>
            setMessages((current) =>
              current.some((existing) => existing.id === message.id)
                ? current
                : [...current, message]
            )
          }
        />
      </main>

      <MembersPanel members={session.members} onProfile={setSelectedProfile} />

      {settingsOpen ? (
        <SettingsModal
          user={session.user}
          onClose={() => setSettingsOpen(false)}
          onSaved={handleProfileSaved}
          onError={setError}
        />
      ) : null}

      {selectedProfile ? (
        <ProfileCard profile={selectedProfile} onClose={() => setSelectedProfile(null)} />
      ) : null}
    </div>
  );
}

function UpdateButton({ status }: { status: UpdateStatus }) {
  if (status.phase === "downloaded") {
    return (
      <button className="update-button ready" onClick={() => window.gcchat.updates.restartAndInstall()}>
        <Download size={16} />
        Update Ready
      </button>
    );
  }

  if (status.phase === "downloading") {
    return (
      <button className="update-button" disabled>
        <Loader2 className="spin" size={15} />
        Updating
      </button>
    );
  }

  return null;
}

function AuthScreen({ onAuth }: { onAuth: (auth: AuthResponse) => void }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const auth =
        mode === "register"
          ? await api.register(username, password)
          : await api.login(username, password);
      onAuth(auth);
    } catch (requestError) {
      setError(getMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-mark">
          <MessageCircle size={30} />
        </div>
        <h1>{mode === "register" ? "Create an account" : "Welcome back"}</h1>
        <form onSubmit={submit} className="auth-form">
          <label>
            Username
            <input
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="username"
            />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              placeholder="8+ characters"
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="primary-button" disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : null}
            {mode === "register" ? "Continue" : "Log in"}
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setMode(mode === "register" ? "login" : "register");
            setError(null);
          }}
        >
          {mode === "register" ? "Already have an account?" : "Need an account?"}
        </button>
      </section>
    </main>
  );
}

function MessageList({
  messages,
  onProfile
}: {
  messages: MessageView[];
  onProfile: (profile: UserProfile) => void;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <section className="message-list empty">
        <div className="empty-state">
          <Hash size={34} />
          <h2>general</h2>
        </div>
      </section>
    );
  }

  return (
    <section className="message-list">
      {messages.map((message) => (
        <article className="message-row" key={message.id}>
          <button className="avatar-button" onClick={() => onProfile(message.author)}>
            <Avatar profile={message.author} size="md" />
          </button>
          <div className="message-body">
            <div className="message-meta">
              <button onClick={() => onProfile(message.author)}>{message.author.displayName}</button>
              <time>{formatTime(message.createdAt)}</time>
            </div>
            {message.content ? <p>{message.content}</p> : null}
            {message.attachments.length > 0 ? (
              <div className="attachments">
                {message.attachments.map((attachment) => (
                  <a
                    className="attachment"
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    key={attachment.id}
                  >
                    {attachment.mimeType.startsWith("image/") ? (
                      <img src={attachment.url} alt={attachment.fileName} />
                    ) : (
                      <span>{attachment.fileName}</span>
                    )}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ))}
      <div ref={bottomRef} />
    </section>
  );
}

function Composer({
  channelId,
  socket,
  onError,
  onFallbackMessage
}: {
  channelId: string;
  socket: ChatSocket | null;
  onError: (error: string | null) => void;
  onFallbackMessage: (message: MessageView) => void;
}) {
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canSend = draft.trim().length > 0 || file;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!canSend || sending) {
      return;
    }

    setSending(true);
    onError(null);

    try {
      const attachments: CreateMessageRequest["attachments"] = [];

      if (file) {
        const uploaded = await api.upload(file, "attachment");
        attachments.push({
          url: uploaded.url,
          fileName: uploaded.fileName,
          mimeType: uploaded.mimeType,
          size: uploaded.size
        });
      }

      const payload = {
        channelId,
        content: draft,
        attachments
      };

      if (socket?.connected) {
        await emitMessage(socket, payload);
      } else {
        const message = await api.createMessage(channelId, {
          content: payload.content,
          attachments
        });
        onFallbackMessage(message);
      }

      setDraft("");
      setFile(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (requestError) {
      onError(getMessage(requestError));
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="composer" onSubmit={submit}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        className="icon-button attach-button"
        onClick={() => fileInputRef.current?.click()}
        aria-label="Add image"
      >
        <ImagePlus size={20} />
      </button>
      <div className="composer-input">
        {file ? (
          <button type="button" className="file-chip" onClick={() => setFile(null)}>
            {file.name}
            <X size={14} />
          </button>
        ) : null}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Message #general"
        />
      </div>
      <button className="send-button" disabled={!canSend || sending} aria-label="Send">
        {sending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
      </button>
    </form>
  );
}

function MembersPanel({
  members,
  onProfile
}: {
  members: ServerMemberView[];
  onProfile: (profile: UserProfile) => void;
}) {
  return (
    <aside className="members-panel">
      <div className="members-title">Members</div>
      {members.map((member) => (
        <button className="member-row" key={member.id} onClick={() => onProfile(member)}>
          <Avatar profile={member} size="sm" />
          <span>{member.displayName}</span>
        </button>
      ))}
    </aside>
  );
}

function SettingsModal({
  user,
  onClose,
  onSaved,
  onError
}: {
  user: UserProfile;
  onClose: () => void;
  onSaved: (profile: UserProfile) => void;
  onError: (error: string) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const previewProfile = useMemo<UserProfile>(
    () => ({
      ...user,
      displayName: displayName || user.username,
      bio,
      avatarUrl: avatarFile ? URL.createObjectURL(avatarFile) : avatarUrl
    }),
    [avatarFile, avatarUrl, bio, displayName, user]
  );

  useEffect(() => {
    return () => {
      if (previewProfile.avatarUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewProfile.avatarUrl);
      }
    };
  }, [previewProfile.avatarUrl]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);

    try {
      let nextAvatarUrl = avatarUrl;

      if (avatarFile) {
        const uploaded = await api.upload(avatarFile, "avatar");
        nextAvatarUrl = uploaded.url;
      }

      const profile = await api.updateProfile({
        displayName,
        bio,
        avatarUrl: nextAvatarUrl
      });
      onSaved(profile);
    } catch (requestError) {
      onError(getMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <form className="settings-modal" onSubmit={save}>
        <header>
          <h2>Settings</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>

        <div className="settings-grid">
          <div className="settings-avatar">
            <Avatar profile={previewProfile} size="xl" />
            <input
              ref={avatarInputRef}
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)}
            />
            <button type="button" className="secondary-button" onClick={() => avatarInputRef.current?.click()}>
              <Upload size={16} />
              Upload
            </button>
            <button
              type="button"
              className="text-button subtle"
              onClick={() => {
                setAvatarFile(null);
                setAvatarUrl(null);
              }}
            >
              Remove
            </button>
          </div>

          <div className="settings-fields">
            <label>
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label>
              About me
              <textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={190} />
            </label>
          </div>
        </div>

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? <Loader2 className="spin" size={17} /> : null}
            Save
          </button>
        </footer>
      </form>
    </div>
  );
}

function ProfileCard({ profile, onClose }: { profile: UserProfile; onClose: () => void }) {
  return (
    <div className="profile-layer" onMouseDown={onClose}>
      <article className="profile-card" onMouseDown={(event) => event.stopPropagation()}>
        <button className="profile-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <div className="profile-banner" />
        <div className="profile-content">
          <Avatar profile={profile} size="lg" />
          <h2>{profile.displayName}</h2>
          <div className="profile-username">
            <AtSign size={14} />
            {profile.username}
          </div>
          <section>
            <h3>Member Since</h3>
            <p>{formatDate(profile.createdAt)}</p>
          </section>
          <section>
            <h3>About Me</h3>
            <p>{profile.bio || "No bio yet."}</p>
          </section>
        </div>
      </article>
    </div>
  );
}

function Avatar({ profile, size }: { profile: UserProfile; size: "sm" | "md" | "lg" | "xl" }) {
  const initials = (profile.displayName || profile.username).slice(0, 2).toUpperCase();

  return (
    <span className={`avatar avatar-${size}`}>
      {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <span>{initials}</span>}
    </span>
  );
}

function applyProfileUpdate(session: Session, profile: UserProfile): Session {
  return {
    ...session,
    user: session.user.id === profile.id ? profile : session.user,
    members: session.members.map((member) =>
      member.id === profile.id ? { ...member, ...profile } : member
    )
  };
}

function emitMessage(socket: ChatSocket, payload: { channelId: string } & CreateMessageRequest) {
  return new Promise<void>((resolve, reject) => {
    socket.emit("message:create", payload, (response) => {
      if (response.ok) {
        resolve();
      } else {
        reject(new Error(response.error));
      }
    });
  });
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}
