# GCChat Codex Handoff

This file is an extensive context pack for future Codex sessions working on GCChat. Read this before making changes, especially in a fresh chat where the previous conversation history is unavailable.

## Project Identity

GCChat is a private social hub for one large friend group. It uses a Discord-inspired interface, but it is not supposed to become a public Discord clone with many independent user-created servers.

The product idea is a shared home base for the group:

- Text chat with channels.
- A shared GC calendar for birthdays, food runs, plans, hangouts, and other events.
- Voice chat and screen sharing.
- Custom emoji and reactions for friend-group jokes.
- Future group tools such as polls, planning features, shared media, memories/timeline, and similar friend-group-specific features.

Important product language:

- The left rail is hub feature navigation, not server navigation.
- The chat feature can have text channels and voice channels.
- The database still has `Server`, `Channel`, and `Membership` tables from the original MVP, but those are legacy implementation details for the single shared hub.
- Do not introduce UI copy that implies users create or switch between separate servers unless the user explicitly changes the product direction.

Related product docs:

- `docs/product.md`
- `docs/ai-feature-brief.md`
- `AGENTS.md`

## Repository Layout

Root:

- `package.json`: workspace scripts for dev, build, tests, Prisma, and desktop publishing.
- `pnpm-workspace.yaml`: pnpm workspace definition.
- `tsconfig.base.json`: shared TypeScript config.
- `.env.example`: local environment template.
- `railway.json`: Railway build/start configuration for the server only.
- `release.config.json`: GitHub owner/repo used by Electron Forge and updater.
- `.github/workflows/release-desktop.yml`: GitHub Actions workflow that builds and publishes desktop releases.
- `AGENTS.md`: high-priority notes for Codex sessions.

Apps and packages:

- `apps/desktop`: Electron Forge + Vite + React + TypeScript desktop app.
- `apps/server`: Express + Socket.IO + Prisma backend.
- `packages/shared`: shared API/event/domain types used by both desktop and server.
- `docs`: product, release, feature, and Codex handoff notes.

Generated or local-only directories:

- `node_modules`
- `apps/desktop/.vite`
- `apps/desktop/out`
- `apps/server/dist`
- `packages/shared/dist`
- `logs`

Do not treat generated build folders as primary source.

## Tech Stack

Runtime and tooling:

- Node with Corepack-managed pnpm.
- TypeScript.
- Monorepo-style pnpm workspaces.

Desktop:

- Electron Forge.
- Vite.
- React.
- `lucide-react` for icons.
- `socket.io-client` for realtime.
- `livekit-client` for voice and screen sharing.
- Electron security posture:
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `sandbox: true`
  - renderer talks to backend APIs/WebSockets and to Electron main through a preload bridge.

Server:

- Express.
- Socket.IO.
- Prisma ORM.
- PostgreSQL hosted on Supabase.
- Supabase Storage for avatars, message attachments, and emoji images.
- Argon2 password hashing.
- JWT app sessions.
- LiveKit Server SDK for short-lived voice room tokens.

Database/storage/services:

- Supabase Postgres is the database.
- Supabase Storage buckets:
  - `avatars`
  - `message-attachments`
- LiveKit Cloud hosts voice and screen share media.
- Railway hosts only `@gcchat/server`.
- GitHub Releases host the desktop installer and auto-update assets.

## Current Production Services

Production backend:

```text
https://gcchatserver-production.up.railway.app
```

GitHub release repo:

```text
Azurelly/GCchat2
```

Desktop app version at the time this file was created:

```text
0.1.23
```

Railway deploys the backend from this repo using `railway.json`.

Desktop releases are built by GitHub Actions from SemVer tags like `v0.1.23`.

## Environment Variables

Local `.env.example` contains the expected variables.

Server variables:

- `PORT`: local/default server port, usually `4197`.
- `CLIENT_ORIGIN`: allowed CORS origin. Local Vite is usually `http://localhost:5173`. On Railway this has often been `*` for MVP desktop usage.
- `JWT_SECRET`: long random secret for signing app JWTs.
- `DATABASE_URL`: Supabase pooled PostgreSQL URL. Prisma runtime connection. Supabase pooler usually port `6543` with `?pgbouncer=true`.
- `DIRECT_URL`: Supabase direct/session PostgreSQL URL for migrations. Supabase pooler usually port `5432`.
- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase secret/service-role key. Server only.
- `SUPABASE_AVATARS_BUCKET`: usually `avatars`.
- `SUPABASE_ATTACHMENTS_BUCKET`: usually `message-attachments`.
- `LIVEKIT_WS_URL`: LiveKit Cloud websocket URL, for example `wss://your-project.livekit.cloud`.
- `LIVEKIT_API_KEY`: LiveKit Cloud API key. Server only.
- `LIVEKIT_API_SECRET`: LiveKit Cloud API secret. Server only. Never expose to desktop, GitHub Actions renderer vars, or committed files.
- `LIVEKIT_ROOM_NAME`: currently `gcchat-general-voice`.

Desktop renderer variable:

- `VITE_API_URL`: API base URL injected into the Vite renderer build.
  - Local default: `http://localhost:4197`.
  - GitHub Actions repo variable for production: `https://gcchatserver-production.up.railway.app`.
  - Do not put the LiveKit secret here.
  - Do not rely on `localhost` for packaged releases.

GitHub Actions repo variable:

- `VITE_API_URL=https://gcchatserver-production.up.railway.app`

Railway server variables:

- All server variables listed above except `VITE_API_URL`.

## Local Development

Use Corepack/pnpm. If `pnpm` is not directly on PATH, use `corepack pnpm`.

Install:

```powershell
corepack enable
corepack prepare pnpm@9.15.4 --activate
corepack pnpm install
```

Generate Prisma client:

```powershell
corepack pnpm prisma:generate
```

Apply deployed migrations:

```powershell
corepack pnpm prisma:deploy
```

Run server and desktop together:

```powershell
corepack pnpm dev
```

Run server only:

```powershell
corepack pnpm dev:server
```

Run desktop only:

```powershell
corepack pnpm dev:desktop
```

Useful checks:

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

The desktop build packages Electron locally and can take a bit.

Because this workspace is on Windows and the sandbox often cannot write Git lock files or Corepack cache files, Codex may need escalated command approval for:

- `corepack pnpm ...`
- `git add`
- `git commit`
- `git push`
- GitHub API polling through PowerShell

## Root Scripts

From root `package.json`:

- `dev`: run server and desktop in parallel.
- `dev:server`: run backend watcher.
- `dev:desktop`: run Electron Forge dev desktop.
- `build`: recursive build for shared, server, desktop.
- `typecheck`: recursive typecheck.
- `test`: server test suite.
- `make:desktop`: Electron Forge make.
- `publish:desktop`: Electron Forge publish through the desktop package script.
- `prisma:generate`: Prisma Client generation.
- `prisma:migrate`: Prisma migrate dev.
- `prisma:deploy`: Prisma migrate deploy.
- `prisma:studio`: Prisma Studio.

The root `publish:desktop` script must stay:

```json
"publish:desktop": "pnpm --filter @gcchat/desktop run publish"
```

This was learned from previous GitHub Actions failures.

## Database Model

The Prisma schema lives at:

```text
apps/server/prisma/schema.prisma
```

Enums:

- `UserRole`: `USER`, `ADMIN`, `SUPER_ADMIN`
- `AuditAction`:
  - `MESSAGE_DELETE`
  - `MESSAGE_RESTORE`
  - `MESSAGE_EDIT`
  - `USER_BAN`
  - `USER_UNBAN`
  - `USER_ROLE_UPDATE`
  - `CALENDAR_EVENT_DELETE`
  - `CALENDAR_EVENT_RESTORE`

Core models:

- `User`
  - username/passwordHash/auth identity.
  - role and ban state.
  - first user in a fresh database becomes `SUPER_ADMIN`.
- `Profile`
  - display name, bio, avatar URL.
  - one profile per user.
- `Server`
  - legacy single hub record, key `global`.
  - not a user-facing multi-server feature.
- `Channel`
  - text channels inside the chat feature.
  - unique by server/name.
- `Membership`
  - legacy single hub membership.
  - users are auto-added to the global hub.
- `Message`
  - channel messages.
  - supports replies, editedAt, soft deletion, deletedBy, attachments, reactions.
- `Attachment`
  - uploaded file metadata attached to messages.
- `MessageReaction`
  - emoji reaction rows, unique by message/user/emoji.
- `CalendarEvent`
  - title, description, startAt, creator, soft deletedAt.
  - past events are not deleted automatically; future timeline/archive work will use historical data.
- `CalendarEventOptIn`
  - attendee rows.
  - creator is opted in automatically.
- `CustomEmoji`
  - admin-created emoji with unique name, image URL, creator, and use count.
- `AuditLog`
  - tracks moderation/admin/destructive actions and restoration metadata.

Important schema/product caveat:

- The tables named `Server`, `Membership`, and global server methods are legacy MVP naming. Keep UI language focused on the shared hub.

## Server Architecture

Entry/source files:

- `apps/server/src/index.ts`: process entrypoint, loads env, creates Prisma repo/storage/realtime, starts HTTP server.
- `apps/server/src/app.ts`: Express app and REST routes.
- `apps/server/src/socket.ts`: Socket.IO realtime and voice presence state.
- `apps/server/src/env.ts`: env loading from root `.env` and local `.env`.
- `apps/server/src/auth.ts`: username normalization, Argon2 hash/verify, JWT sign/verify.
- `apps/server/src/storage.ts`: Supabase Storage and fallback storage abstraction.
- `apps/server/src/validation.ts`: Zod request schemas.
- `apps/server/src/repositories/chatRepository.ts`: repository interface.
- `apps/server/src/repositories/prismaChatRepository.ts`: Prisma implementation.
- `apps/server/tests`: Vitest tests.

Repository pattern:

- `ChatRepository` abstracts database behavior.
- `PrismaChatRepository` enforces most domain permission checks and maps Prisma rows into shared view models.
- Tests can use in-memory repository implementations.

Important server behavior:

- `ensureGlobalCommunity()` creates/keeps the single global hub and default `general` channel.
- `getBootstrap(userId)` ensures membership and returns current user, global server, active/default channel, channel list, and member list.
- `createUser()` makes the first account `SUPER_ADMIN`; later accounts are `USER`.
- `requireActiveUser()` blocks banned users after auth and makes logged-in banned users see the banned screen.
- Realtime publisher methods are injected into REST routes so REST changes can fan out over sockets.

## REST API Summary

Unauthenticated:

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`

Authenticated:

- `GET /me`
- `PATCH /me/profile`
- `PATCH /me/account`
- `GET /users/:id/profile`
- `POST /voice/token`
- `GET /servers/:id/members`
- `POST /channels`
- `DELETE /channels/:id`
- `GET /channels/:id/messages`
- `POST /channels/:id/messages`
- `PATCH /messages/:id`
- `DELETE /messages/:id`
- `POST /messages/:id/reactions`
- `GET /embeds/youtube`
- `GET /calendar/events`
- `POST /calendar/events`
- `PATCH /calendar/events/:id/opt-in`
- `DELETE /calendar/events/:id`
- `GET /audit`
- `POST /audit/:id/restore`
- `GET /emojis`
- `POST /emojis`
- `PATCH /emojis/:id`
- `DELETE /emojis/:id`
- `POST /uploads`

Authentication:

- Desktop stores a JWT in localStorage.
- API sends `Authorization: Bearer <token>`.
- Socket.IO handshake uses the token as `socket.handshake.auth.token`.

## Shared Package

Source:

```text
packages/shared/src/index.ts
```

This package defines the common types used across desktop and server. Keep API response/request/event types here so both sides compile against the same contract.

Important shared concepts:

- `UploadKind`: `avatar`, `attachment`, `emoji`
- `UserRole`
- `AuditAction`
- `UserProfile`
- `ServerMemberView`
- `MessageView`, `MessageReplyView`, `MessagePageView`, `MessageReactionView`
- `CalendarEventView`, `CalendarEventOptInView`
- `CustomEmojiView`
- `AuditLogView`
- `VoiceTokenResponse`
- `VoiceStateView`, `VoiceParticipantState`
- `ClientToServerEvents`
- `ServerToClientEvents`

When adding API routes or realtime events, update this package first, then server and desktop.

GitHub Actions must build `@gcchat/shared` before clean-runner typechecks.

## Realtime Socket.IO

Socket server:

```text
apps/server/src/socket.ts
```

Client connects in:

```text
apps/desktop/src/App.tsx
```

Client-to-server events:

- `channel:join`
- `message:create`
- `voice:join`
- `voice:leave`
- `voice:self-state`
- `voice:moderate`

Server-to-client events:

- `message:new`
- `message:updated`
- `message:deleted`
- `profile:updated`
- `members:updated`
- `channels:updated`
- `session:banned`
- `calendar:event:upsert`
- `calendar:event:deleted`
- `audit:new`
- `emojis:updated`
- `voice:state`
- `voice:moderated`
- `voice:force-disconnect`

Online indicators:

- Server tracks connected socket counts per user in `onlineUsers`.
- `members:updated` maps `isOnline` onto member rows.
- Multiple app windows/sockets per user are handled by counts, not booleans.

## Voice And Screen Sharing

Voice media uses LiveKit Cloud. The GCChat server does not relay audio/video. It only authenticates users and mints short-lived LiveKit tokens through `POST /voice/token`.

Current voice model:

- Single voice channel named `General Voice`.
- LiveKit room name comes from `LIVEKIT_ROOM_NAME`, currently `gcchat-general-voice`.
- The client joins LiveKit directly after receiving a token from the server.
- The Socket.IO server separately tracks voice presence and moderation state so users can see active calls without joining LiveKit.

Client LiveKit code is in `apps/desktop/src/App.tsx`.

Electron screen/window picking:

- Main process uses `desktopCapturer` and exposes screen source selection through `window.gcchat.screens`.
- Preload bridge is in `apps/desktop/src/preload.ts`.
- Renderer selects a source, then `getDisplayMedia` uses the selected Electron display media source.

Voice presence concepts:

- `VoiceParticipantState`
  - `selfMuted`
  - `selfDeafened`
  - `serverMuted`
  - `serverDeafened`
  - `screenSharing`
  - `reconnecting`
  - `joinedAt`
  - `updatedAt`
- The server keeps:
  - `voiceParticipants`
  - `voiceParticipantSockets`
  - `voiceModeration`
  - reconnect grace timers
- Disconnects mark participants reconnecting for a grace period instead of immediately nuking them.

Admin voice moderation:

- Admins can moderate regular users.
- Super Admins can moderate users/admins.
- Admins cannot server mute/deafen/disconnect Super Admins or other Admins.
- Users cannot moderate themselves.
- Server mute/deafen state is in-memory at the moment, not persisted in Postgres.

Voice debugging:

- The app has a voice diagnostics modal and logs many events.
- Client diagnostics include LiveKit state, Socket.IO presence state, active speakers, track events, audio attach/detach, and server ack state.
- Server logs voice events with `[voice] ...` JSON in stdout.
- If users report vanishing from VC or screen sharing flapping, ask for voice diagnostics logs and Railway server logs around the same time.

Known voice lessons already learned:

- Do not derive the visible VC list only from LiveKit participants. Users not joined to LiveKit still need to see active calls.
- Do not remove a participant just because their socket reconnects briefly; use the reconnect grace path.
- Keep screen sharing state synchronized through both LiveKit track state and Socket.IO `voice:self-state`.
- Per-user volume is local client state and must not affect other users.
- Server mute must not accidentally become self mute when removed.
- Deafen visually implies muted, similar to Discord.

## Desktop Architecture

Source files:

- `apps/desktop/src/main.ts`
  - Electron main process.
  - Frameless BrowserWindow.
  - app menu removed.
  - auto-updater setup.
  - window controls IPC.
  - screen source IPC.
- `apps/desktop/src/preload.ts`
  - safe `window.gcchat` bridge.
  - exposes updates, window controls, and screens.
- `apps/desktop/src/api.ts`
  - REST API client.
  - `API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4197"`.
- `apps/desktop/src/App.tsx`
  - Main React app, state machine, sockets, LiveKit, screenshare, chat, calendar, emoji studio, audit, settings, modals.
  - This file is large; prefer extracting new components only when it reduces real complexity and avoids risky churn.
- `apps/desktop/src/styles.css`
  - App styling. Keep Discord-inspired but original.

Active features:

```ts
type ActiveFeature = "chat" | "calendar" | "emojis" | "audit";
```

Feature visibility:

- Chat: visible to all active users.
- Calendar: visible to all active users.
- Emoji Studio: visible to Admin and Super Admin.
- Audit Log: visible only to Super Admin.

Local storage keys exist for:

- auth token
- notification preferences
- appearance preferences
- voice volume preferences
- locally muted voice users

Settings page:

- Full-page Discord-like settings, not a tiny modal.
- Current categories:
  - My Account
  - Notifications
  - Appearance
- My Account supports profile edit, bio, avatar, nickname/display name, username, password.
- Notifications include ping settings/sounds/toasts.
- Appearance includes dark mode default plus other themes.

Custom title bar:

- Electron menu bar is removed.
- App uses a custom title bar like Discord.
- Update controls live in the title bar.
- When no update is ready, show a small `Check` button.
- When downloaded, show a small update/restart button.

## Current Feature Set

Auth and accounts:

- Register with username/password.
- Login with username/password.
- Passwords are Argon2 hashes.
- JWT sessions.
- First account becomes Super Admin.
- Profile view includes avatar, creation date, bio/about, role/banned indicators.
- Users can edit display name, bio, avatar, username, and password.
- Banned users cannot login; if banned while online, app de-renders to banned screen with log out option.

Roles:

- `USER`: normal friend-group user.
- `ADMIN`: can create text channels and manage emojis.
- `SUPER_ADMIN`: can do admin actions plus delete text channels, ban/unban, grant/remove Admin, view audit logs, restore certain audited deletions.

Chat:

- Single hub chat feature with text channels.
- Admins can create text channels.
- Super Admins can delete text channels after typing exact channel name.
- Messages persist in Postgres.
- Message history loads in chunks using `MessagePageView` with `hasMore` and `nextBefore`.
- Realtime new/updated/deleted messages through Socket.IO.
- Optimistic message sending exists to make sending feel instant.
- Consecutive messages from the same author are compacted/pooled like Discord when close together.
- Replies via right-click context menu.
- Replies ping/notify the replied-to author.
- Clicking reply preview should jump to the original message rather than opening the profile.
- Users can edit and delete their own messages.
- Super Admins can delete other users' messages.
- Deleted messages are soft deleted and audit logged so they can be restored.
- Edited messages show `(edited)` and are audit logged.

Mentions/pings:

- `@` opens a member autocomplete menu above the composer.
- Pinging should be intentionally invasive for this friend group:
  - highlighted message for mentioned user
  - sound
  - bottom-right notification/toast
  - user preferences in settings
- Replying to a message should function like a ping to the original author.

Reactions and emoji:

- Message context menu has Reply and Add Reaction.
- Reactions display under messages with counts/users.
- Default Unicode emoji picker exists.
- Custom emojis are created by admins in Emoji Studio.
- Custom emoji tokens use `:emoji_name:`.
- Custom emoji usage increments use counts.
- Emoji Studio supports upload image, name emoji, list/grid, edit, rename, replace image, delete, show creator and use count.
- Emoji Studio is admin-only.

Attachments and embeds:

- Uploads go through `POST /uploads` and Supabase Storage.
- Attachment bucket can support future non-image attachments; name is still `message-attachments`.
- Image attachments display inline.
- Clicking an image should open a Discord-like media overlay, not immediately navigate to the URL.
- Overlay has icon-only actions with tooltips such as save/download and open in browser.
- Audio attachments embed as a player with play/pause, progress seek, time, volume, and hover download.
- YouTube links auto-preview.
- YouTube iframe playback may show YouTube error 153 or other embed restrictions for some videos. This may be a YouTube-side embed policy issue; keep a browser/open fallback.
- Event links embed calendar event cards in chat.
- Event embeds show title, description, full date including year, attendee icons, follow/open buttons.

Calendar:

- Any user can create an event with title, description, date, and exact time.
- Event creator is shown and automatically opted in.
- Users can opt in/out.
- Event creator and admins can delete events.
- Deleting an event currently soft deletes and audit logs it.
- Past events are not currently moved into a timeline UI, but the user wants a future timeline/archive for past events, with images and comments later.
- Calendar sidebar "Upcoming" list shows upcoming events, including year, and is clickable to open that event.
- If a calendar date has multiple events, show a list; selecting one shows event detail, and a back button returns to the list.
- Upcoming events list shows condensed attendee avatars for first few people and `+X`.

Audit log:

- Super Admin-only feature tab.
- Tracks deleted messages, edited messages, ban/unban, role changes, calendar event deletion/restoration.
- Deleted messages and deleted events can be restored from audit log when supported.
- Each log entry has action timestamp and actor/target metadata.

Voice:

- Single `General Voice` channel under the chat feature.
- Join/leave voice.
- Voice connection states:
  - connecting
  - connected
  - reconnecting
  - disconnected
  - failed
- Bottom-left voice status/control panel.
- Mute, deafen, disconnect.
- Per-user local volume slider and local mute.
- Speaking indicators.
- Server mute/deafen/disconnect admin controls.
- VC participant list remains visible to users not in the call.
- Users not in a call can see who is connected, muted/deafened/server-muted, screen sharing, and can click Join.

Screen sharing:

- Users can share their screen/window.
- Sharing user gets LIVE badge.
- Others can preview or watch stream.
- Stream view replaces chat content area.
- Stream view should feel like Discord:
  - large stream in center
  - participant tiles below
  - control bar below tiles
  - stop watching, mute, share screen, deafen, disconnect
- Multiple streams can be selected/watched.
- If streamer stops, viewer should cleanly return or show ended state.
- Hover previews should not clip behind the right side of the app.

## Desktop Auto-Update And Release Flow

Mission:

Users download the Windows installer once from GitHub Releases. Later releases auto-detect in installed builds and show an in-app update button that restarts and installs the update.

Do not host the desktop app on Railway. Railway is only for `@gcchat/server`.

Release system:

- Electron Forge with Squirrel Windows maker.
- GitHub Actions publishes release assets.
- Electron autoUpdater checks GitHub Releases.
- `apps/desktop/forge.config.ts` uses `PublisherGithub` with `draft: false` and `prerelease: false`.
- `apps/desktop/src/main.ts` sets Windows feed URL to:

```text
https://github.com/Azurelly/GCchat2/releases/latest/download
```

Release assets must include:

- `GCChat-X.Y.Z.Setup.exe`
- `GCChat-X.Y.Z-full.nupkg`
- `RELEASES`

If a release only has source zip/tar.gz, it is just a tag, not a packaged app release. Wait for or fix the GitHub Action.

Codex owns this workflow by default:

When the user asks for a feature/fix that should reach installed desktop users, Codex should not stop after local edits. Unless the user explicitly says not to release yet, Codex should:

1. Bump `apps/desktop/package.json` to the next SemVer version.
2. Run checks:

   ```powershell
   corepack pnpm typecheck
   corepack pnpm test
   corepack pnpm build
   ```

3. Stage and commit.
4. Push `main`.
5. Create and push matching tag:

   ```powershell
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

6. Monitor GitHub Actions workflow `Release desktop app`.
7. Confirm GitHub Release assets include the installer, `.nupkg`, and `RELEASES`.
8. Tell the user what shipped and link the release.

Example GitHub Actions polling through PowerShell:

```powershell
$repo='Azurelly/GCchat2'
$tag='v0.1.23'
$headers=@{'User-Agent'='gcchat-codex'}
$runs=Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/actions/runs?per_page=20" -Headers $headers
$run=$runs.workflow_runs | Where-Object { $_.head_branch -eq $tag -or $_.display_title -like "*$tag*" } | Select-Object -First 1
$run.html_url
```

Verify release assets:

```powershell
$release=Invoke-RestMethod -Uri "https://api.github.com/repos/Azurelly/GCchat2/releases/tags/vX.Y.Z" -Headers @{ 'User-Agent'='gcchat-codex' }
$release.assets | ForEach-Object { $_.name }
```

Important release lessons:

- GitHub repo Settings -> Actions -> General -> Workflow permissions must be `Read and write permissions`.
- The release workflow must generate Prisma Client and build `@gcchat/shared` before typechecking.
- If `Publish desktop release` fails with branch or npm publish errors, verify it uses `pnpm --filter @gcchat/desktop run publish`.
- If latest release remains old, check draft releases and `draft: false`.
- Do not force-move public release tags. For normal updates, always make a new version and tag.
- Desktop updater can take time to detect GitHub latest changes, but it should generally work once the release assets exist.
- Manual Check button should query regardless of the 10-minute interval.

Docs-only changes:

- Do not need a desktop release tag because installed users do not need docs.
- It is still reasonable to commit/push docs so future sessions and machines see them.

## Railway Deploy Flow

Railway hosts only the server.

Config:

```text
railway.json
```

Build command:

```powershell
corepack pnpm prisma:generate && corepack pnpm --filter @gcchat/shared build && corepack pnpm --filter @gcchat/server build
```

Start command:

```powershell
corepack pnpm prisma:deploy && corepack pnpm --filter @gcchat/server start
```

Healthcheck:

```text
/health
```

Common Railway failures:

- Missing `DATABASE_URL` or `DIRECT_URL`: Prisma migration fails and healthcheck times out.
- Bad `DIRECT_URL`: migrations fail.
- Missing LiveKit vars: voice token endpoint returns 503.
- Wrong CORS `CLIENT_ORIGIN`: desktop/socket may not connect.
- Shared package module mismatch: previously fixed by making shared build compatible and building shared before server.

If server code or Prisma schema changes:

- Push to GitHub.
- Railway should redeploy the server service.
- Watch Railway logs and healthcheck.
- If a migration is added, ensure `DIRECT_URL` is present.

If only desktop UI changes:

- Railway may not redeploy, and that is expected.

## Supabase Setup Notes

Database:

- Use Supabase Postgres.
- Use Prisma `DATABASE_URL` pooled connection with pgbouncer.
- Use `DIRECT_URL` for migrations.

Storage:

- Public bucket `avatars`.
- Public bucket `message-attachments`.
- `message-attachments` is intentionally broad because future attachments may include images, audio, stickers, polls, calendars/events, and other payloads.
- For MVP, server enforces type/size, and Supabase bucket MIME settings can also reject uploads.
- If audio uploads fail after client embed appears optimistically, check Supabase Storage bucket allowed MIME types first. `audio/mpeg` or `audio/*` must be allowed for MP3 files.
- Allowed MIME settings in Supabase need real MIME strings, such as `image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/wav,audio/ogg,audio/webm`, not labels like `JPG, PNG`.

Never commit Supabase service-role keys.

## LiveKit Setup Notes

LiveKit Cloud project settings provide:

- WebSocket URL, for example `wss://...livekit.cloud`
- API key
- API secret

Put these only on Railway/server env:

- `LIVEKIT_WS_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

The desktop receives only a short-lived room token from GCChat server.

One LiveKit room can host multiple participants in the current single voice channel. If future work adds multiple voice channels, either:

- use distinct room names per voice channel, or
- keep one room but namespaced state carefully.

The cleaner future path is one LiveKit room per voice channel.

## Testing Strategy

Before shipping app changes:

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Server tests:

- `apps/server/tests/app.test.ts`
- `apps/server/tests/realtime.test.ts`

Known tested areas include:

- registration/login
- duplicate usernames
- login failure
- profile updates
- message persistence/history
- realtime message delivery
- voice presence behavior

Manual smoke tests after UI-heavy changes:

- Register/login.
- Send text message.
- Upload image/audio attachment.
- Send/edit/delete/reply/react to message.
- Mention a user and verify notification/highlight.
- Switch text channels and verify history loads promptly.
- Scroll upward far into chat history and verify chunk loading.
- Create calendar event and opt in/out.
- Link event in chat and open it.
- Join voice with two clients.
- Mute/deafen/server mute.
- Share screen and watch stream.
- Click images and verify overlay behavior.
- Check updater button in installed packaged build when a new release is available.

## UI/UX Direction

The app should feel Discord-inspired but original.

General UI rules from the user's preferences:

- Build the actual usable app, not a landing page.
- Keep operational screens dense and usable.
- Use the left rail for hub feature navigation.
- Keep chat channel list only in the Chat feature.
- Calendar should not appear as a text channel.
- Avoid UI overlap, clipping, and weird scrollbars.
- Use lucide icons when possible.
- Use icon-only controls with hover tooltips for familiar actions.
- Settings should be a full-page Discord-like view with categories.
- Chat composer should closely resemble Discord: attachment icon, input, emoji button, send button.
- Right-click context menus should be compact and Discord-like.
- Voice/screen share UI should closely resemble Discord layouts.
- Online indicator should not be clipped by avatar circles.
- Image viewer should behave like Discord, with overlay and icon actions rather than opening links immediately.

Avoid:

- Introducing separate server UX/copy.
- Letting chat bottom bars disappear when messages overflow.
- Visible scrollbars in side panels unless truly needed.
- One-off decorative hero/marketing UI.
- Breaking compact message grouping.

## Known Recent Issues And Fixes

Recent release history context:

- `0.1.22`: audio attachments, YouTube embeds, stream cut-off fixes.
- `0.1.23`: clickable upcoming event cards, event years, attendee previews in linked event embeds, compact grouped-message spacing.

Audio upload issue:

- The user saw MP3 optimistic embed briefly, then upload failed.
- They confirmed the root cause was Supabase bucket configuration.
- Do not overfit server upload code unless failures persist after bucket MIME config is correct.

YouTube embed issue:

- Some embeds show YouTube "Error 153" or playback configuration errors.
- This may be YouTube embed restrictions. Keep open-in-browser fallback.

Voice issues that have been debugged:

- Users disappearing/reappearing in voice roster.
- Tabbing out/in triggering presence weirdness.
- Screen share LIVE badge appearing briefly then disappearing.
- Hover preview clipping.
- Local volume crash due setting HTMLMediaElement volume outside `[0, 1]`.
- Server mute causing regular mute when removed.
- Disconnecting someone leaving stale self-presence.

When touching voice code, preserve diagnostics and be cautious.

Chat history:

- A chunked loading system exists using `GET /channels/:id/messages?page=1&before=<messageId>&limit=<n>`.
- Make sure new message rendering does not break infinite upward scroll.

## Permissions Model Details

Admins:

- Create text channels.
- Manage custom emojis.
- Voice moderate regular users.

Super Admins:

- Everything Admins can do.
- Delete text channels with exact-name confirmation.
- Ban/unban users.
- Grant/remove Admin.
- Delete others' messages.
- Delete/restore eligible events/messages through audit log.
- View Audit Log tab.
- Voice moderate admins and users.

Admin limitations:

- Admins cannot delete text channels.
- Admins cannot ban/unban.
- Admins cannot grant/remove Admin.
- Admins cannot moderate Super Admins or other Admins in voice.

Banned users:

- Still appear in member list.
- Name is gray/struck and has `Banned` indicator.
- Cannot log in.
- If banned while online, receive `session:banned` and see banned screen with log out option.

## Message And Calendar Deletion Semantics

Messages:

- Deletion is soft delete in DB.
- Content/metadata should be preserved in audit logs.
- Super Admin can restore deleted messages from audit log.
- Users can delete their own messages.
- Super Admins can delete others' messages.

Calendar events:

- Deletion is currently soft delete plus audit log.
- Users can delete their own events.
- Admins can delete events.
- Restorable through audit log.
- Future planned concept: past events become archived timeline entries with images/comments, but that UI is not implemented yet.

## File Uploads And Attachments

Upload flow:

1. Renderer selects file.
2. Renderer calls `api.upload(file, "attachment")`.
3. Server receives multipart form through `multer`.
4. Server validates file type and size in `storage.ts`.
5. Server uploads to Supabase Storage.
6. Renderer sends message with uploaded attachment metadata.

Limits:

- `multer` limit: 10 MB, one file.
- Zod attachment schema max size: 10 MB.
- Message attachments array max: 4.

Current file types should include images, common audio, PDFs/text/Office/zip depending on server allowed MIME list and Supabase bucket config.

If uploads fail:

- Check server validation first.
- Check Supabase bucket MIME restrictions second.
- Check bucket public access.
- Check `SUPABASE_SERVICE_ROLE_KEY`.

## Git Practices

The user expects Codex to handle Git and release workflow when appropriate.

Use normal non-interactive commands:

```powershell
git status --short
git diff
git add <files>
git commit -m "Message"
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

Avoid:

- `git reset --hard`
- `git checkout --` on user changes unless explicitly requested
- force-moving public tags
- broad destructive cleanup

The worktree may be dirty. Do not revert unrelated changes.

If Git complains about permission denied on `.git/index.lock` in the sandbox, use escalated git command approval.

## How To Decide Whether To Release

Release desktop updater:

- UI changes users need.
- Desktop code changes.
- Shared type changes used by desktop.
- Any feature/fix that should reach installed desktop users.

Deploy Railway/server:

- Server source changes.
- Prisma schema/migration changes.
- Shared contract changes used by server.
- Environment variable changes may require redeploy/restart.

Docs-only changes:

- Usually commit/push is enough.
- No desktop SemVer tag needed.
- No Railway deploy needed.

If both desktop and server change:

1. Ensure server changes are backward compatible if possible.
2. Push main so Railway deploys.
3. Verify Railway health.
4. Then tag desktop release so clients use the updated backend contract.

## Future Feature Ideas Already Mentioned

The user has mentioned or implied these future directions:

- Polls.
- More calendar/event planning tools.
- Timeline/archive for events that have happened.
- Add images and comments to timeline events.
- More attachment types: stickers, polls, calendars, app-like embeds.
- More voice channels later.
- Better streaming/screen share polish.
- Richer notification settings.
- More appearance themes.
- Group-specific social media features.

Do not add these preemptively unless the user asks. But design new architecture with them in mind.

## Safe Defaults For Future Codex Work

When implementing:

- Read existing code first.
- Prefer local patterns.
- Keep changes scoped.
- Update shared types before server/desktop if API contracts change.
- Add/adjust tests for server behavior.
- Run typecheck/test/build before release.
- For frontend, verify layout by running locally when possible.
- For voice/screen sharing, preserve diagnostics and test with multiple users when possible.
- For release-worthy desktop changes, own the full release flow.

When answering the user:

- Be concise but clear.
- If something is docs-only or server-only, say that no desktop updater release was needed.
- If a release was made, link the GitHub release and mention assets/checks.

