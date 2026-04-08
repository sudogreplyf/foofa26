# ⚽ FIFA World Cup 2026 Predictor

A full-stack web app where users predict match results and exact scores for FIFA World Cup 2026.

## Features

- **Unique accounts** – every player registers with their own username & password (JWT auth). No one else can change your predictions.
- **Predict result + score** – choose Home Win / Draw / Away Win, then optionally predict the exact scoreline.
- **Bonus points** – correct result = **3 pts**, correct exact score = **5 pts** (3 + 2 bonus).
- **Prediction lock** – predictions close automatically **1 hour before kick-off**.
- **Leaderboard** – real-time global rankings by points.
- **Admin panel** – admins enter final scores; the app auto-scores all predictions instantly.
- **60 matches seeded** – full group stage (Groups A–H, 48 matches) + knockout placeholders through the Final.

## Getting Started

```bash
npm install
node server.js
```

Open http://localhost:3000

## Making a User an Admin

After registering an account, run:

```bash
node make-admin.js <username>
```

Admins can enter match results via the **Admin** tab in the navbar.

## Scoring System

| Prediction           | Points |
|----------------------|--------|
| Correct W/L/D only   | 3 pts  |
| Correct exact score  | 5 pts  |
| Wrong result         | 0 pts  |

## Tech Stack

- **Backend**: Node.js, Express, SQLite (via `sqlite` + `sqlite3`)
- **Auth**: bcryptjs + JSON Web Tokens
- **Frontend**: Vanilla HTML/CSS/JS (SPA-style, no framework)
