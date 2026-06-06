# Group to Glory

World Cup prediction analytics plus a public bracket pool.

## What is built

- Deployable Next.js app with tabs for Bracket Pool, Group Stage, Knockouts, and Leaderboard.
- Bracket Pool opens first and supports group standings, third-place advancers, model-pick fill, final-on-submit rules, and PNG generation.
- Group Stage and Knockouts prediction panels show probabilities, projected score, likely scorers, clean sheets, corners, shots, saves, cards, fouls, confidence, and model drivers.
- Supabase-ready schema for Google login, one official bracket per user, profiles, data snapshots, and leaderboard scoring.
- Admin status page at `/admin` with refresh and scoring hooks.
- `.env.example` includes OpenAI, sports API, Supabase, admin, and cron keys.

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

## Environment

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
SPORTS_API_KEY_A=
SPORTS_API_KEY_B=
SPORTS_API_KEY=
BALLDONTLIE_FIFA_API_KEY=
ADMIN_EMAIL=
CRON_SECRET=
```

Recommended free sports-data key for this app: BALLDONTLIE FIFA World Cup API.
Use `SPORTS_API_KEY_A` or `BALLDONTLIE_FIFA_API_KEY` for World Cup-specific teams, rosters, matches, standings, lineups, events, and stats when available. Use `SPORTS_API_KEY_B` or `SPORTS_API_KEY` for API-Football as the fallback provider.

## Supabase

Run `supabase/schema.sql` in your Supabase SQL editor. Enable Google auth in the Supabase dashboard, then add the public URL and anon key to `.env`.

## Scheduled refresh

Use a Vercel cron or similar scheduler:

- `/api/admin/refresh` every 12 hours
- `/api/admin/score` more often during matchdays

Send `x-cron-secret` when `CRON_SECRET` is set.
