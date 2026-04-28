# Releasing GCChat Desktop

This app uses Electron Forge, GitHub Releases, and Electron's built-in updater.

## One-time Setup

1. Push this project to a public GitHub repository.
2. Edit `release.config.json`:

   ```json
   {
     "githubOwner": "your-github-username-or-org",
     "githubRepo": "your-repo-name"
   }
   ```

3. In GitHub, open the repository settings and confirm GitHub Actions can write releases:
   - Settings -> Actions -> General
   - Workflow permissions -> Read and write permissions
4. Host the backend server somewhere public before real users install the app. Railway is the simplest recommended MVP host for this Node/Socket.IO backend.
5. In GitHub, add a repository variable:
   - Settings -> Secrets and variables -> Actions -> Variables
   - Name: `VITE_API_URL`
   - Value: your hosted backend URL, for example `https://api.yourdomain.com`

## First Release

1. Update `apps/desktop/package.json` version, for example `0.1.1`.
2. Commit and push the change.
3. Create and push a matching SemVer tag:

   ```powershell
   git tag v0.1.1
   git push origin v0.1.1
   ```

4. GitHub Actions will build the Windows installer and create a draft GitHub Release.
5. Open the draft release, verify the files, and publish it.

## What Users Download

Users install the `.exe` from the latest GitHub Release. Windows Squirrel output includes:

- `GCChat Setup.exe`
- a `.nupkg` package used by auto-update
- `RELEASES` metadata used by auto-update

Keep all generated release assets attached to the GitHub Release.

## How Updates Work

Installed production builds check GitHub Releases through Electron's update service.
When a newer published release exists, the app downloads it in the background. After
download, the chat header shows an `Update Ready` button. Clicking it calls
Electron's updater restart/install flow, closes the app, installs the update, and
reopens the app on the new version.

Draft and prerelease GitHub Releases are not used for normal auto-updates.

## Codex Responsibility

When Codex finishes a change that should ship to installed desktop users, Codex should handle the full release flow unless the user explicitly asks to pause before release. That includes bumping `apps/desktop/package.json`, committing and pushing `main`, creating and pushing the matching `vX.Y.Z` tag, checking the GitHub Actions workflow, and telling the user when the draft release is ready to publish.

## Important Notes

- The repo must be public for the free Electron update service.
- Public desktop builds must use a public `VITE_API_URL`; `http://localhost:4197` only works on your machine.
- macOS auto-update requires code signing. This setup starts with Windows.
- Do not publish releases with the placeholder `CHANGE_ME` values in `release.config.json`.
