# GCChat Agent Notes

These notes are for future Codex sessions working in this repository. Keep them current when the release/update flow changes.

## Product Direction

GCChat is a private social hub for one large friend group. It should feel like a central home base for chat, calendar events, polls, plans, and future group-specific features. It is not intended to become a public Discord clone with multiple user-created servers.

Use the left rail as feature navigation for the shared hub. The top feature is chat. The next feature is the GC calendar. The existing `Server`, `Channel`, and `Membership` database names are legacy MVP implementation details for the single shared hub; do not expose new UI copy that implies people are creating or switching between separate servers unless the user explicitly changes direction.

User-facing product notes live in `docs/product.md`.

## Desktop Distribution And Auto-Update

The mission is: users download `GCChat Setup.exe` once from GitHub Releases, then installed Windows builds auto-detect later published GitHub Releases and show an in-app `Update Ready` button that restarts and installs the update.

Do not host the desktop app on Railway. Railway is only for `@gcchat/server`. The desktop app is packaged by GitHub Actions and distributed through GitHub Releases.

Current production backend:

```text
https://gcchatserver-production.up.railway.app
```

Where settings belong:

- Railway `@gcchat/server` variables: `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `CLIENT_ORIGIN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_AVATARS_BUCKET`, `SUPABASE_ATTACHMENTS_BUCKET`.
- GitHub repo Actions variable: `VITE_API_URL=https://gcchatserver-production.up.railway.app`.
- Do not put `VITE_API_URL` on Railway unless it is needed for a separate Railway build; the release workflow injects it into the Electron renderer build.

Release checklist:

1. Bump `apps/desktop/package.json` to the next SemVer version, for example `0.1.1`.
2. Commit and push the code change to `main`.
3. Create and push a matching tag from that commit:

   ```powershell
   git tag v0.1.1
   git push origin v0.1.1
   ```

4. Wait for GitHub Actions workflow `Release desktop app`.
5. Open the draft release created by Electron Forge.
6. Confirm it includes real app assets, especially `GCChat Setup.exe`, a `.nupkg`, and `RELEASES`.
7. Publish the draft release. Drafts and prereleases do not update installed apps.

First-release setup caveat: while testing before anyone has installed the app, it is acceptable to move `v0.1.0` to a fixed commit:

```powershell
git tag -f v0.1.0
git push --force origin v0.1.0
```

Avoid force-moving tags after a release has been shared publicly. For normal updates, always create a new version and tag.

CI lessons already learned:

- The root script must run the package script explicitly:

  ```json
  "publish:desktop": "pnpm --filter @gcchat/desktop run publish"
  ```

- The release workflow must generate Prisma Client and build `@gcchat/shared` before typechecking on GitHub's clean runner.
- GitHub repo Settings -> Actions -> General -> Workflow permissions must be `Read and write permissions`.
- If a release only shows `Source code (zip)` and `Source code (tar.gz)`, that is a tag, not the packaged app release. The installer release is created by Actions.
- If the workflow fails in `Publish desktop release` with branch or npm publish errors, check that the command is using Electron Forge through `pnpm --filter @gcchat/desktop run publish`.

Installed production builds use Electron's updater against GitHub Releases. The app exposes update status through the preload bridge and shows the update button in the chat header.
