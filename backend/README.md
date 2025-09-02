Backend API - Database Setup

Overview
- Express server with PostgreSQL via `pg` and `.env` configuration.

Environment
- Create `backend/.env` based on `.env.example`:

```
DATABASE_URL=postgresql://username:password@host:5432/database
# PGSSL=true            # Uncomment if your DB requires SSL
# PGPOOL_MAX=10         # Optional: pool size
# PGPOOL_IDLE=30000     # Optional: idle timeout (ms)
# PG_CONNECT_TIMEOUT=5000
```

Local Development
- Install dependencies: `npm run install:all` (from repo root) or `cd backend && npm install`.
- Start backend only: `npm run dev:backend`
- Or start full stack (proxy + frontend + backend): `npm run dev`

Health Checks
- Backend health: `curl http://localhost:3001/api/health`
- DB health: `curl http://localhost:3001/api/db-health`

Notes
- The server loads env from `backend/.env` explicitly, so it works regardless of the working directory or the Docker context.
- If connecting to a managed Postgres that enforces TLS, set `PGSSL=true` in `.env`.
