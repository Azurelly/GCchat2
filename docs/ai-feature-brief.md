# GCChat AI Feature Brief

Use this document as context for another AI when brainstorming, designing, or prioritizing new GCChat features. It describes what the app is, what already exists, how the product should feel, and the constraints future ideas should respect.

## Short Pitch

GCChat is a private desktop social hub for one large friend group. It is inspired by Discord's interaction model and visual language, but it is not meant to become a public Discord clone with many independent servers.

The app should feel like a shared home base for the friend group: chat, calendar events, plans, polls, media, memories, decisions, hangouts, birthdays, food runs, trips, and future group-specific tools.

The key product idea is:

> A private friend-group operating system: casual enough for everyday conversation, but structured enough to coordinate real-life plans.

## Audience

The users are members of one real friend group. This is not a general public product yet. Feature ideas should assume users already know each other, share context, and want tools that make the group easier and more fun to coordinate.

Design implications:

- Prioritize speed, clarity, and group usefulness over broad public-platform features.
- Avoid generic social media mechanics unless they improve the friend group's actual workflows.
- Make coordination features easy to use while chatting.
- Keep the Discord-like familiarity, but tailor the app toward a single shared hub.
- It is okay for notifications and pings to be more direct than in a public app because the group is private and intentional.

## Product Direction

GCChat has one shared hub. The leftmost rail is not a server switcher. It is feature navigation.

Current feature rail:

- Chat: the main realtime conversation area.
- GC calendar: shared events for birthdays, food plans, hangouts, trips, and important dates.
- Emoji Studio: an admin-only area for creating and managing friend-group custom emojis.

Possible future feature rail items:

- Polls.
- Planning boards.
- Shared media.
- Group memories.
- Food/restaurant voting.
- Trip planning.
- Game nights.
- Shared lists.
- Announcements.
- Member profiles or directory.

Important constraint:

- The app should not introduce user-created servers unless the product direction intentionally changes.
- Database tables named `Server`, `Channel`, and `Membership` are currently implementation details from the MVP foundation. In product language, this is one shared friend-group hub.

## Current Tech Stack

The app is a monorepo-style Electron project:

- `apps/desktop`: Electron + Vite + React + TypeScript.
- `apps/server`: Express API + Socket.IO realtime backend.
- `packages/shared`: shared TypeScript types for API and websocket contracts.

Backend and storage:

- Hosted API: Railway.
- Database: Supabase-hosted Postgres.
- ORM: Prisma.
- Realtime transport: Socket.IO.
- File storage: Supabase Storage.
- Desktop distribution: GitHub Releases with Electron auto-update.

Security and desktop assumptions:

- Electron uses `contextIsolation: true`.
- Electron renderer does not get direct Node access.
- Renderer talks to the backend through REST APIs and Socket.IO.
- Desktop builds use a custom title bar and GitHub-release-based update flow.

## Current App Structure

The desktop UI is Discord-inspired:

- Custom top title bar.
- Left feature rail.
- Chat channel sidebar when Chat is active.
- Main content area.
- Right member/upcoming-events panel depending on feature.
- Bottom user panel.
- Full-page settings screen.

The user should generally feel like they are inside a polished private Discord-style client, but with friend-group-specific features instead of generic servers.

## Authentication And Accounts

Current auth features:

- Register with username and password.
- Login with username and password.
- Passwords are stored as Argon2id hashes, never plaintext.
- JWT sessions are used for API and websocket auth.
- The first account in a fresh database becomes Super Admin automatically.
- All users automatically join the shared hub when they register.

Current account settings:

- Change profile picture.
- Change bio/about me.
- Change nickname/display name.
- Change username.
- Change password.

Profile fields currently shown in profile cards:

- Avatar/profile picture.
- Display name.
- Username.
- Account creation date.
- Bio/about me.
- Role badges/status where applicable.
- Banned state where applicable.

## Profiles And Presence

Current profile features:

- Users can click member avatars/names to open a Discord-like profile card.
- Profile cards show avatar, name, username, bio, account creation date, and role/status context.
- Users can personalize their profile from settings.

Current presence features:

- Online users show a green dot next to their profile picture.
- Offline users show a gray indicator.
- Presence is based on whether the user has the app open and connected.
- Banned users still appear in the member list, but their names are gray/struck through and marked as banned.

## Chat

The Chat feature is the main conversation space.

Current chat features:

- Text channels in the shared hub.
- `# general` exists as the default channel.
- Realtime messages through Socket.IO.
- Message history persisted in Postgres.
- Message history loads from the backend.
- Messages appear instantly on the sender's client through optimistic UI.
- Confirmed server messages replace the temporary local message.
- Channel switching uses local cached message history when available so switching feels immediate.
- Message list auto-scrolls to new messages.
- Member list appears on the right side of chat.
- Chat input stays fixed and visible even when long message history fills the channel.
- The current user panel stays fixed at the bottom left.

Current message content features:

- Plain text messages.
- File attachments.
- Calendar event embeds.
- User mentions with `@username`.
- Mention autocomplete above the chat bar.
- Mention highlighting in rendered messages.
- Built-in Unicode emojis from the chat composer.
- Custom image emojis rendered from `:emoji_name:` tokens.

Current attachment UX:

- The composer has an attachment button.
- Clicking it opens a small menu.
- Current attachment types:
  - Upload a file.
  - Link event.

Upload behavior:

- Files are uploaded through the server to Supabase Storage.
- The server validates file type and size.
- Supported MVP file types include common images, GIFs, PDFs, text/CSV, ZIPs, and Office documents.
- Supabase Storage buckets currently include avatars and message attachments.

Event-link behavior:

- The user can attach an existing calendar event to a chat message.
- Events are listed nearest-first.
- The message displays an event embed.
- The embed includes event title, description, date/time, and actions.
- Users can follow/opt into the event from the chat embed.
- Users can open the event in the Calendar tab from the embed.

## Emojis

GCChat supports both built-in Unicode emojis and custom friend-group emojis.

Current emoji features:

- The chat composer has a Discord-like emoji button.
- Clicking the emoji button opens a small scrollable emoji picker above the chat bar.
- The picker includes a default emoji set.
- The picker includes custom GCChat emojis when they exist.
- Unicode emojis are inserted directly into messages.
- Custom emojis are inserted as `:emoji_name:` tokens and render as inline images in chat.
- Custom emoji usage is counted when messages containing those tokens are sent.

Admin-only Emoji Studio:

- Admins and Super Admins see an Emoji Studio feature tab in the far-left feature rail.
- Regular users do not see the Emoji Studio tab.
- Admins can upload an image/GIF and name the emoji.
- Admins can view all custom emojis in a grid.
- The grid shows each emoji, its token name, creator, and use count.
- Clicking an emoji opens an edit dialog.
- Admins can rename an emoji.
- Admins can replace an emoji image.
- Admins can delete an emoji.
- Emoji images are uploaded through the backend and stored in Supabase Storage.

## Mentions And Notifications

Mentions are designed to be direct and noticeable because this is a private friend group app.

Current mention features:

- Typing `@` in the chat composer opens a member autocomplete list.
- The list filters as more letters are typed.
- Selecting a member inserts the username mention into the draft.
- Mentioned users receive a notification if they have the app open.

Current notification features:

- Bottom-right in-app toast when mentioned.
- Mention sound.
- Optional system notification through the OS Notification API.
- Notification behavior can be configured in settings.

Current notification settings:

- Enable/disable mention popups.
- Enable/disable mention sounds.
- Enable/disable system notifications.
- Choose notification sound.
- Adjust notification volume.
- Test notification sound.

## Calendar

The GC calendar is the second main feature in the left feature rail.

Purpose:

- Track important events for the friend group.
- Coordinate plans with exact dates and times.
- Keep birthdays, food runs, hangouts, trips, and important group events visible.

Current calendar features:

- Month-style calendar view.
- Any registered user can create events.
- Event form supports:
  - Title.
  - Description.
  - Date.
  - Exact time.
- Event stores and displays who created it.
- Event creator is automatically marked as going.
- Users can opt in or out of events.
- Event details show who is going.
- Upcoming events list appears on the right.
- Upcoming list shows condensed attendee avatars for the first few people going plus a `+X` count when more people are going.
- Selecting a date with multiple events shows a list for that day.
- Selecting an event shows its details.
- A back button returns from event detail to the selected day's list.
- Chat event embeds can jump directly to the calendar and open the selected event.

## Roles And Moderation

Current roles:

- User.
- Admin.
- Super Admin.

Admin powers:

- Create new text channels in the Chat feature.
- Admins cannot delete text channels.

Super Admin powers:

- Everything Admins can do.
- Delete text channels.
- Deleting a text channel requires typing the channel name for validation.
- Ban user accounts.
- Unban user accounts.
- Give Admin to users.
- Remove Admin from users.

Moderation UX:

- Admin and Super Admin actions appear in profile/context menus where appropriate.
- Ban/unban and role actions are accessible from user profile interactions.
- Banned users remain visible in the member list with disabled styling.
- Banned users are gray, struck through, and marked `BANNED`.
- If a banned user tries to log in, they see `You are banned` and a `Log out` option.
- If a user is banned while currently logged in, the app de-renders the normal UI and immediately shows the banned screen with a `Log out` option.

## Settings

Settings are a full-page Discord-style screen rather than a small modal.

Current settings tabs:

- My Account.
- Notifications.
- Appearance.

My Account includes:

- Profile picture upload/remove.
- Nickname/display name.
- Username.
- Bio/about me.
- Password change.

Notifications includes:

- Mention popup toggle.
- Mention sound toggle.
- System notification toggle.
- Notification sound selector.
- Volume slider.
- Test sound button.

Appearance includes:

- Theme selector.
- Current themes:
  - Dark, the default.
  - Light.
  - Midnight.
  - Forest.
  - Berry.

## Desktop App And Updates

GCChat is meant to be downloaded once as a Windows installer and then auto-update.

Current distribution flow:

- Users download `GCChat Setup.exe` from GitHub Releases.
- Desktop releases are built by GitHub Actions.
- The app checks GitHub Releases for updates.
- If no update is ready, the title bar shows a small manual `Check` button.
- When an update is downloaded and ready, the title bar shows a small update button.
- Clicking the update button restarts the app and installs the update.
- Railway hosts only the backend server, not the desktop app.

Release rule:

- Draft or prerelease GitHub releases do not update installed clients.
- A release must be published and include the generated app assets, not just source code archives.

## Backend API Capabilities

Current REST/API areas:

- Auth:
  - Register.
  - Login.
  - Load current user/session bootstrap.
- Profiles:
  - Update profile.
  - Get user profile.
  - Update account username/password.
- Channels:
  - List via bootstrap.
  - Create text channel.
  - Delete text channel with confirmation.
  - Fetch channel messages.
  - Create channel message.
- Uploads:
  - Upload avatars.
  - Upload message attachments.
- Calendar:
  - List events.
  - Create event.
  - Opt in/out of event.
- Admin/moderation:
  - Update user role.
  - Ban/unban user.

Current websocket/event areas:

- Join chat channels.
- Create message.
- Receive new messages.
- Receive profile updates.
- Receive channel changes.
- Receive role/ban changes.
- Presence online/offline updates.

## Data Model Concepts

Current core data concepts:

- User: login identity, username, password hash, role, banned state.
- Profile: display name, bio, avatar URL, creation date.
- Server: implementation detail for the single shared hub.
- Channel: text channels inside the Chat feature.
- Membership: user membership in the shared hub.
- Message: persisted chat message.
- Attachment: file metadata for message attachments.
- CalendarEvent: shared event with title, description, creator, date/time.
- CalendarEventParticipant: opt-in/going records for events.
- CustomEmoji: uploaded friend-group emoji image, token name, creator, and use count.

## Existing UX Principles

When adding features, preserve these ideas:

- The app should feel fast. Use optimistic UI when possible.
- The left rail is for hub features, not servers.
- The channel sidebar belongs to Chat only.
- Important coordination objects should be shareable in chat.
- Friend-group features should be more useful than generic public social features.
- Avoid cluttering the first screen with marketing or explanations.
- Settings should scale because more feature-specific preferences will be added later.
- New controls should feel native to the Discord-inspired UI.
- Use compact, practical layouts over large decorative sections.

## Good Future Feature Directions

Strong candidates for future features:

- Polls that can be embedded in chat.
- Availability voting for event times.
- Birthday tracking with automatic recurring calendar events.
- RSVP questions for events, such as who is driving or bringing something.
- Food run planning with restaurant suggestions, orders, and who is paying.
- Event reminders and notification scheduling.
- Event comments or event-specific threads.
- Shared photo albums for events.
- Memory timeline for past hangouts.
- Friend group announcements.
- Lightweight task lists for trips or plans.
- Custom roles/badges for inside jokes or friend-group identity.
- Per-channel notification settings.
- Message reactions.
- Reply/thread support.
- Search across messages/events.
- Pinned messages.
- Richer profile customization.
- Mobile companion app later, if the desktop app becomes useful enough.

## Feature Brainstorming Prompt

When asking another AI for ideas, use this prompt:

> You are helping design future features for GCChat, a private desktop social hub for one large friend group. It is Discord-inspired but not a many-server clone. The left rail is feature navigation for the group hub: Chat, GC calendar, Emoji Studio for admins, and future tools like polls or planning. Current features include realtime text channels, profiles, online presence, admin/super-admin moderation, file attachments, mention autocomplete and notifications, full-page settings, themes, custom emojis, calendar events with opt-ins, and chat-embedded calendar events. Suggest practical, fun, friend-group-specific features that make communication, planning, and memories better. Prioritize features that integrate naturally with chat and calendar, feel fast, and fit a private group rather than a public social network.

## Open Product Questions

Useful questions to answer before major new features:

- Should GCChat eventually support multiple friend groups, or stay one private group forever?
- Should calendar events support recurring birthdays and yearly reminders?
- Should notifications become per-channel, per-person, or per-feature?
- Should the app support voice/video, or stay focused on text and planning?
- Should there be mobile support later?
- Should admins be able to edit events, or only creators?
- Should uploaded files have long-term organization, albums, or cleanup rules?
- Should event opt-in support statuses like going, maybe, not going, needs ride, driving?
- Should polls become their own feature tab, message embeds, or both?
- Should every major object, such as polls/events/lists, be embeddable in chat?
