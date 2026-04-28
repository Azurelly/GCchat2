# GCChat Product Purpose

GCChat is a private social hub for a large friend group. It is not meant to become a public Discord clone with many independent servers.

The left rail is feature navigation for the shared group hub:

- Chat: the main place for channels, messages, profiles, and realtime conversation.
- General Voice: a single shared LiveKit-powered voice channel inside the Chat feature.
- GC calendar: shared friend-group events such as birthdays, food plans, hangouts, trips, and other important dates.
- Emoji Studio: admin-only custom emoji creation and management for friend-group inside jokes and shared reactions.
- Future feature tabs may include polls, planning tools, media, memories, or other group-specific experiences.

The current database still has `Server`, `Channel`, and `Membership` tables from the MVP foundation. Treat those as implementation details for the single shared hub unless the product direction changes. New UI should use hub/feature language instead of implying users create or switch between separate servers.

Calendar MVP behavior:

- Any registered user can create an event with title, description, date, and exact time.
- The event stores and displays the creator.
- Users can opt in or out of events.
- The event creator is automatically opted in when creating an event.
- Calendar data is persisted in Postgres and updates live through the app's websocket refresh path.

Permissions model:

- The first account in a fresh database is promoted to Super Admin automatically.
- Admins can create text channels in the Chat feature.
- Super Admins can create/delete text channels, ban/unban accounts, and grant/remove Admin.
- Banned users stay visible in member lists with disabled-looking styling, but cannot use the app.

Emoji behavior:

- All users can send default Unicode emoji from the chat composer.
- Custom emojis are represented as `:emoji_name:` tokens and render as inline images.
- Admins and Super Admins can create, rename, replace, and delete custom emojis in Emoji Studio.
- Emoji Studio shows who created each emoji and how many times it has been used in messages.

Voice MVP behavior:

- Users can join one shared `General Voice` channel from the Chat sidebar.
- LiveKit Cloud hosts the realtime audio room.
- The GCChat server mints short-lived voice tokens after normal app authentication.
- Users can mute/unmute their microphone and disconnect from the voice channel.
