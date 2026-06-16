# Releasing DeNoti

This document is the source of truth for cutting a DeNoti release. Every release — automated or manual — should follow these steps and use the notes format below.

## Steps

1. **Decide the version bump.** Look at commits since the last tag (`git log vX.Y.Z..HEAD --oneline`) and pick the next semver version: `patch` for fixes/polish, `minor` for new features, `major` for breaking changes.

2. **Bump the version.**
   - Update `"version"` in `package.json`.
   - Commit as `chore: X.Y.Z` (no other changes in this commit).

3. **Tag the release.**
   ```bash
   git tag vX.Y.Z
   ```

4. **Push the commit and tag.**
   ```bash
   git push origin main
   git push origin vX.Y.Z
   ```

5. **Build artifacts for all platforms.**
   ```bash
   npm run package
   ```
   This produces, under `release/`:
   - macOS: `.dmg` and `.zip` for `x64` and `arm64`
   - Linux: `.AppImage` and `.deb` for `x64` and `arm64`
   - Windows: `.exe` (nsis installer) for `x64`
   - Auto-update metadata: `latest-mac.yml`, `latest-linux.yml`, `latest-linux-arm64.yml`, `latest.yml`

   Verify the `version:` field inside the generated `.yml` files matches the release before uploading — stray artifacts from a previous/aborted build can linger in `release/`.

6. **Create a draft GitHub release** with the built artifacts attached, using the format described below.
   ```bash
   gh release create vX.Y.Z --repo damasioj/DeNoti --draft --title "vX.Y.Z" --notes "..." \
     release/DeNoti-X.Y.Z-mac-x64.dmg \
     release/DeNoti-X.Y.Z-mac-x64.zip \
     release/DeNoti-X.Y.Z-mac-arm64.dmg \
     release/DeNoti-X.Y.Z-mac-arm64.zip \
     release/DeNoti-X.Y.Z-linux-x86_64.AppImage \
     release/DeNoti-X.Y.Z-linux-amd64.deb \
     release/DeNoti-X.Y.Z-linux-arm64.AppImage \
     release/DeNoti-X.Y.Z-linux-arm64.deb \
     release/DeNoti-X.Y.Z-win-x64.exe \
     release/latest-mac.yml \
     release/latest-linux.yml \
     release/latest-linux-arm64.yml \
     release/latest.yml
   ```
   If any large asset fails to upload silently, re-run `gh release upload vX.Y.Z <missing-file>` — don't assume the first command got everything; check `gh release view vX.Y.Z --json assets`.

7. **Leave the release as a draft** for review. Do not publish it without explicit approval — publishing is a visible, user-facing action.

8. **When approved, publish it as the latest release — not a prerelease.** This step is required, not optional: `electron-updater`'s GitHub provider resolves updates via `/releases/latest`, and GitHub excludes both drafts *and* prereleases from that endpoint. A release left as draft or prerelease is invisible to the auto-updater on every platform, even though it's reachable by URL.
   ```bash
   gh release edit vX.Y.Z --repo damasioj/DeNoti --draft=false --prerelease=false --latest
   ```
   Verify it took effect before considering the release done:
   ```bash
   gh release list --repo damasioj/DeNoti --limit 1 --json tagName,isDraft,isPrerelease,isLatest
   ```
   Expect `isDraft: false`, `isPrerelease: false`, `isLatest: true`. If `isLatest` is false, the auto-updater will not find this release no matter what else is correct.

## Release notes format

Follow the structure used in `v0.2.1` (and every release since). Sections are omitted if empty — don't include a heading with no bullets under it.

```
<One-line summary of what this release is / why it matters, if useful context. Optional.>

## ✨ Features
- **Bolded short name** — one-sentence description of the feature and its effect on the user.

## 🐛 Fixes
- Plain-sentence description of the bug and what now happens instead.

## 🔧 Maintenance
- Dependency bumps, CI changes, refactors — anything not user-facing.

---

## Install
- **macOS** — download the `.dmg` for your chip: `arm64` (Apple Silicon) or `x64` (Intel).
- **Windows** — download and run the `.exe` installer.
- **Linux** — `.AppImage` (portable) or `.deb` (Debian/Ubuntu), in `x64` or `arm64`.

> ℹ️ macOS builds are unsigned. If the app is blocked on first launch, right-click it and choose **Open**, or allow it under **System Settings → Privacy & Security**.
```

Notes:
- Group every commit since the last tag into Features / Fixes / Maintenance based on its conventional-commit prefix (`feat:` → Features, `fix:` → Fixes, `chore:`/`refactor:`/`build:` → Maintenance).
- The **Install** section and unsigned-macOS callout are boilerplate — copy them verbatim into every release.
