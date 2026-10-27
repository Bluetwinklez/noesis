# Releasing

1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Add `docs/releases/vX.Y.Z.md`. The release workflow picks it up from the tag name and fails if it is missing.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The **Release** workflow first validates that the tag matches the package, Cargo and Tauri versions and that release notes exist. A Linux job runs TypeScript, unit/integration, production dependency audit and browser workflow checks. Its Windows job runs Rust tests, builds with `npx tauri build`, and produces:
   - `Noesis_X.Y.Z_x64-setup.exe` (NSIS, per-user install, English/Turkish installer UI, uninstaller registered in "Apps & features")
   - `Noesis_X.Y.Z_x64_en-US.msi` / `tr-TR` (WiX)
   - `SHA256SUMS.txt`

   It installs, launches and uninstalls the NSIS build as a smoke test, then publishes everything as a GitHub **pre-release**.
   The release job never bypasses checks to publish an installer. Preview downloads use `/releases`, since `/releases/latest` excludes pre-releases.
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
