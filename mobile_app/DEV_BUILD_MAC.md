# CaseLift Mobile — Mac development build

This app uses an **Expo development build** (custom native client), **not Expo Go**. You compile and install CaseLift on a simulator or physical iPhone, then load JavaScript from Metro on your Mac.

## Prerequisites

| Tool | Notes |
|------|--------|
| **macOS** | Required for iOS builds |
| **Xcode** | Full Xcode.app from the App Store (not Command Line Tools alone) |
| **Xcode Command Line Tools** | `xcode-select --install` if needed |
| **CocoaPods** | `sudo gem install cocoapods` (used after `expo prebuild`) |
| **Node.js** | LTS 20+ recommended |
| **npm** | Comes with Node |

Optional for a physical device:

- Apple ID added in Xcode → **Settings → Accounts**
- iPhone on the **same Wi‑Fi** as your Mac (for loading the JS bundle)

## 1. Environment

From the repo root:

```bash
cd mobile_app
cp .env.example .env.local
```

Edit `.env.local` and set the same Supabase values as the web app:

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

Install dependencies:

```bash
npm install
```

## 2. Generate the native iOS project

The `ios/` folder is not committed. Generate it once (or again after adding native modules):

```bash
npx expo prebuild --platform ios
```

Install CocoaPods:

```bash
cd ios && pod install && cd ..
```

## 3. Build and install the dev client

### iOS Simulator (simplest)

```bash
npx expo run:ios
```

This compiles the app, installs it on the default simulator, and usually starts Metro. The simulator can reach Metro at `localhost:8081`.

### Physical iPhone

1. Connect the phone via USB (or use wireless debugging in Xcode).
2. Open the `.xcworkspace` file inside `ios/` in Xcode (not the `.xcodeproj`).
3. Select your **Team** under **Signing & Capabilities** for the CaseLift target.
4. Choose your device and run:

```bash
npx expo run:ios --device
```

Or press **Run** in Xcode.

Trust the developer certificate on the phone if prompted (**Settings → General → VPN & Device Management**).

## 4. Start Metro (day-to-day development)

After the dev client is installed, you normally only need Metro for JS changes.

**Terminal 1 — bundler (uses your Mac’s LAN IP for physical devices):**

```bash
cd mobile_app
npm run start:dev
```

You should see something like:

```text
CaseLift dev client → http://192.168.x.x:8081
```

**Simulator:** open the CaseLift app; it should connect automatically.

**Physical iPhone:** open CaseLift → **Development servers** → use the URL from the terminal, e.g. `http://192.168.x.x:8081`. Do **not** use `127.0.0.1` on a real device — that points at the phone itself.

To pin a specific IP (e.g. if you have multiple interfaces):

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.42 npm run start:dev
```

Find your Wi‑Fi IP on Mac:

```bash
ipconfig getifaddr en0
```

## 5. Rebuild the native app (when needed)

Run a full native rebuild only when you:

- Add or upgrade a library with native code (e.g. `@react-native-async-storage/async-storage`)
- Change `app.json` plugins or permissions
- Change splash/icon assets that require native regeneration

```bash
npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..
npx expo run:ios
```

## Troubleshooting

### “Could not connect to development server”

- Mac and iPhone must be on the **same Wi‑Fi**.
- Use your Mac’s **LAN IP** in the dev client, not `localhost`.
- Allow incoming connections to port **8081** if macOS Firewall prompts you.
- Restart Metro: `npm run start:dev`

### Metro shows `localhost` but the phone can’t load JS

Run with an explicit host:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=$(ipconfig getifaddr en0) npx expo start --dev-client --host lan
```

### CocoaPods / Xcode errors after prebuild

```bash
cd ios
pod deintegrate
pod install
cd ..
npx expo run:ios
```

### Supabase gate on launch

If the app says Supabase is not configured, check `mobile_app/.env.local` and restart Metro (`npm run start:dev`).

### Microphone / recording

The dev build requests microphone permission for consult recording. Grant it when prompted; the string is configured in `app.json` (`NSMicrophoneUsageDescription`).

## Useful commands

| Command | Purpose |
|---------|---------|
| `npm run start:dev` | Metro for dev client (LAN IP) |
| `npx expo run:ios` | Build + install on simulator |
| `npx expo run:ios --device` | Build + install on connected iPhone |
| `npx expo prebuild --platform ios --clean` | Regenerate `ios/` from `app.json` |
| `npm run lint` | Lint the mobile app |

## What this is not

- **Expo Go** — not supported; native modules (recording, secure storage, dev client) require this custom build.
- **App Store release** — see root `IOS_BUILD.md` for the legacy Capacitor web wrapper; this Expo app is a separate native stack (`com.caselift.mobile`).

## App identity

- **Bundle ID:** `com.caselift.mobile`
- **Deep link scheme:** `caselift` / `exp+caselift-mobile` (dev client)

## Push notifications (per-user)

Notification preferences are **per user** (`public.user_notification_settings`) and shared
with the web app — the in-app **More → Notifications** screen reads/writes the same row, so
toggles sync both ways. Push tokens live in `public.user_devices`.

**Enabling real push delivery (one-time setup — not done yet):**

1. **DB migration** — apply `supabase/migrations/20260612120000_per_user_notifications.sql`
   via the Supabase SQL editor (the project's migration history is unreliable, so don't
   `db push`). It creates the two tables, RLS, and a behavior-preserving backfill.
2. **EAS project id** — run `eas init` in `mobile_app/`. Add the resulting id to `app.json`
   under `expo.extra.eas.projectId`. Without it, `registerForPushNotifications()` cleanly
   no-ops (`reason: no_eas_project_id`).
3. **APNs key** — `eas credentials` → iOS → set up a Push Notifications key (.p8) for
   `com.caselift.mobile`. This is what actually authorizes delivery to Apple.
4. **Rebuild + device** — `npx expo prebuild --platform ios --clean && npx expo run:ios --device`
   on a **physical iPhone**. The iOS Simulator cannot receive remote push, so token
   registration only succeeds on a real device.

**How delivery works:** the `notify-staff` edge function resolves every practice member's
per-user prefs (`_shared/recipients.ts`) and sends email / SMS / push (`_shared/expo-push.ts`)
per their toggles. Push payloads use patient initials only (they transit Apple/Google).
