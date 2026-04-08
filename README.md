# ⚽ Live Match Predictor

A full-stack match prediction app using **real-world fixtures/results** synchronized from OpenLigaDB.

## What changed

- External schedule integration (no synthetic fixture seeding).
- Expanded match schema for live states: `status`, `live_minute`, `home_score`, `away_score`, sync metadata.
- Indexed lookups for fast status/time/league queries.
- Real-time UI refresh (15s polling) with score-change highlight animation.
- Admin Test Mode:
  - **Manual Sync**: fetches latest fixtures/results from OpenLigaDB.
  - **Mock Live Update**: simulates a live scoring event to validate DB + UI reactivity.

## External data source

- API: `https://api.openligadb.de/getmatchdata/{league}/{season}`
- Default league/season:
  - `OPENLIGA_LEAGUE_SHORTCUT=bl1`
  - `OPENLIGA_SEASON=<current UTC year>`

## Setup

```bash
npm install
node server.js
```

Open `http://localhost:3000`.

On startup the server attempts an external sync. If unavailable, the app remains empty until admin manual sync succeeds.

## Admin workflows

1. Register/login.
2. Promote user:
   ```bash
   node make-admin.js <username>
   ```
3. Open **Admin** tab.
4. Use **Manual Sync** and **Mock Live Update** to validate ingestion and UI updates.

## Environment variables

- `OPENLIGA_BASE_URL` (default `https://api.openligadb.de`)
- `OPENLIGA_LEAGUE_SHORTCUT` (default `bl1`)
- `OPENLIGA_SEASON` (default current UTC year)
- `EXTERNAL_SYNC_INTERVAL_MS` (default `120000`)
- `PORT` (default `3000`)
- `JWT_SECRET`


## Deploying on Netlify

> Short answer: this repo is **not Netlify-ready as-is** because it uses a long-running Express server + SQLite file DB (`server.js`, `db.js`). Netlify is built for static sites + serverless functions.

If you still want Netlify, use this pattern:

1. **Frontend on Netlify**
   - Keep `public/` as the deployed site.
2. **Backend elsewhere** (Render/Railway/Fly.io)
   - Deploy the Express API (`server.js`) on a Node host that supports persistent processes.
   - Use a persistent database (Postgres/MySQL) instead of local SQLite.
3. **Point frontend to backend URL**
   - Add a frontend env var like `API_BASE_URL=https://your-api.example.com`.

If you want a full Netlify-only setup, you must refactor:
- Convert Express routes in `routes/*.js` into Netlify Functions (`netlify/functions/*`).
- Replace SQLite with a network DB.
- Remove assumptions about in-memory/live server state and background polling in a single long-running process.

