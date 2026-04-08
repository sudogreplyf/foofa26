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
