# CaseLift — iOS (Capacitor) build & App Store submission

The React/Vite web app is now wrapped with **Capacitor 8**. The web UI is built
to `dist/` and copied into a native iOS shell under `ios/`. This document covers
the steps that must be completed **on a Mac with full Xcode and an Apple
Developer account** — they cannot be done from the build agent environment
(only Xcode Command Line Tools are present here, and CocoaPods is not installed).

## What's already configured (committed + integrated)

- `capacitor.config.json` — `appId: com.caselift.app`, `appName: CaseLift`, `webDir: dist`.
- `ios/` native project **using CocoaPods**, with pods already installed:
  `Capacitor 8.3.4`, `CapacitorCordova 8.3.4`, `CapacitorVoiceRecorder 7.0.6`.
  Open **`ios/App/App.xcworkspace`** (the workspace, not the `.xcodeproj`).
- Microphone permission in `ios/App/App/Info.plist` (`NSMicrophoneUsageDescription`).
- Native microphone recording via the `capacitor-voice-recorder` plugin
  (`src/lib/nativeRecorder.js`); the recording modal auto-detects native vs web.
- Safe-area insets (`viewport-fit=cover` + `env(safe-area-inset-*)` on the app shell)
  so the UI clears the notch/status bar/home indicator.
- npm scripts: `npm run cap:sync`, `npm run cap:ios`, `npm run cap:android`.
- The web bundle has been built (`dist/`) and copied into `ios/App/App/public`.

CocoaPods was used (not SPM) because `capacitor-voice-recorder` ships a podspec
only. `pod install` has already run successfully, so nothing pod-related is left
to do unless you change plugins (then: `cd ios/App && pod install`).

## Prerequisites for the final archive/submit (your Mac)

The ONLY remaining steps require tools that can't run on a headless/CLT-only
machine:

1. **Full Xcode.app** (App Store, ~12 GB), then
   `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
   (Command Line Tools alone can run `pod install` but cannot archive/sign an app.)
2. An **Apple Developer Program** membership ($99/yr) for signing + submission.

## Build, run, and archive

```bash
# Refresh the web build into the native project after any web change:
npm run build && npx cap copy ios

# Open the workspace in Xcode:
npx cap open ios          # opens ios/App/App.xcworkspace
```

In Xcode:
1. Select the **App** target → **Signing & Capabilities** → choose your Team
   (this sets the provisioning profile). Confirm the **Bundle Identifier**
   (`com.caselift.app` — change if you own a different one).
2. Set **Display Name**, **Version** (e.g. `1.0.0`) and **Build** (e.g. `1`).
3. Add an app icon set in `Assets.xcassets` (1024×1024 marketing icon required).
4. Pick a real device or "Any iOS Device (arm64)" and **Product → Run** to smoke-test
   (verify login, the mic permission prompt, and a test recording end-to-end).
5. **Product → Archive** → **Distribute App → App Store Connect → Upload**.

## App Store Connect

1. Create the app record at https://appstoreconnect.apple.com (same bundle ID).
2. Fill in privacy details — declare **Microphone** usage and, because this is
   healthcare-adjacent, complete the data-collection/privacy questionnaire
   (consult audio, patient contact info). Provide a privacy policy URL.
3. Attach the uploaded build, add screenshots, and submit for review.

## Notes / gotchas

- **Auth redirects:** on device the web origin is `capacitor://localhost`. Plain
  email/password login works as-is. If you later use magic-link / OAuth redirects,
  register a deep link and add `capacitor://localhost` (or a custom scheme) to the
  Supabase allowed redirect URLs.
- **Env vars:** `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are baked into the
  bundle at `npm run build` time, exactly like the web deploy.
- **Android** is installed (`@capacitor/android`) but not scaffolded. When ready:
  install Android Studio + SDK, then `npx cap add android && npm run cap:android`.
  The voice-recorder plugin supports Android via Gradle (no CocoaPods issue there).
- Re-run `npm run build && npx cap sync ios` after every web change before archiving.
