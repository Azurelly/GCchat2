# GCChat2

A Discord-inspired Electron messaging MVP with a central Node API, Socket.IO realtime chat, Prisma, Supabase Postgres, and Supabase Storage.

## Recommended Services

- Database: Supabase Postgres.
- Profile pictures and message images: Supabase Storage buckets named `avatars` and `message-attachments`.
- Local MVP fallback: Prisma can point at any PostgreSQL-compatible database URL.

## Setup

1. Install dependencies with Corepack-managed pnpm:

   ```powershell
   corepack enable
   corepack prepare pnpm@9.15.4 --activate
   pnpm install
   ```

   If the `pnpm` shim is not on your PATH yet, use `corepack pnpm install` and prefix the
   scripts below with `corepack pnpm`.

2. Copy `.env.example` to `.env` and fill in Supabase/Postgres secrets. Use Supabase's pooled Prisma URL for `DATABASE_URL` and the direct/session URL for `DIRECT_URL`.

3. Generate Prisma client and apply migrations:

   ```powershell
   pnpm prisma:generate
   pnpm prisma:deploy
   ```

4. Run the server and desktop app:

   ```powershell
   pnpm dev
   ```

The first registered account creates and joins the global server/channel automatically; every later account is also added to it.

## Desktop Releases

Desktop installer publishing and auto-update setup is documented in `docs/releasing.md`.
