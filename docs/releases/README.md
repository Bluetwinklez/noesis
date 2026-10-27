# Releasing

1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Add `docs/releases/vX.Y.Z.md` and point `.github/workflows/release.yml` at it.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The **Release** workflow runs on `windows-latest`. It runs the TS and Rust tests, runs `npx tauri build`, and produces:
   - `Noesis_X.Y.Z_x64-setup.exe` (NSIS, per-user install, English/Turkish installer UI, uninstaller registered in "Apps & features")
   - `Noesis_X.Y.Z_x64_en-US.msi` / `tr-TR` (WiX)
   - `SHA256SUMS.txt`

   It attaches them to a **draft** GitHub release for manual review.
5. Install the artifact on a clean Windows 10/11 x64 machine and run the acceptance checklist in `docs/implementation-status.md`.

## Building locally on Windows

Prerequisites: Node 24, Rust stable (MSVC), Visual Studio 2022 Build Tools (C++), WebView2 (preinstalled on Windows 11).

```powershell
npm ci
npx tauri build
Get-FileHash src-tauri\target\release\bundle\nsis\*.exe -Algorithm SHA256
```

If the build fails with `os error 4551` ("An Application Control policy has blocked this file"), Smart App Control or WDAC is blocking the freshly built unsigned binaries. Build on a machine or CI runner without that policy. Do not disable the policy on a machine you do not own.

## Code signing

**Installers are not signed.** No signing certificate is configured, so Windows SmartScreen shows an "unknown publisher" warning. To sign builds, provide a certificate and set `bundle.windows.certificateThumbprint` (or a `signCommand`, for example for Azure Trusted Signing) in `tauri.conf.json` through CI secrets. Never describe an unsigned artifact as signed.

## Updates

There is no auto-updater. Settings → Updates says that updates are manual and are downloaded from the release page.
