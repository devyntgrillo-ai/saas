# CaseLift Mobile

React Native (Expo) companion app for practice users — record consults, view dashboard stats, consults, inbox, training, and basic settings.

## Setup

```bash
cd mobile_app
cp .env.example .env.local
# Fill EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (same project as the web app)
npm install
npx expo start
```

## Scope

- Practice users only (TCs, owners, viewers with limited access)
- Multi-location practice switching
- Dashboard KPIs, consults schedule/archive
- **Consult detail** — transcript, AI analysis, recording playback, outcome controls
- **Inbox** — conversation list, thread view, SMS/email replies
- Native recording → upload → transcribe pipeline
- **Training** — module catalog, video player, progress tracking
- **Coaching** — realtime chat with CaseLift support channel
- Sequences desktop gate, basic settings (profile, sign out)

Agency/reseller and super-admin portals are not included — those users see a desktop-only message.
