Backend API - Database Setup

Overview
- Express server with PostgreSQL via `pg` and `.env` configuration.

Environment
- Create a single `.env` at the repository root based on `/.env.example`:

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=...
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

SSE Chat Completions (OpenRouter)
- Endpoint: `POST http://localhost:3001/api/v1/chat/completions`
- Streaming: Server-Sent Events (forwards upstream chunks)
- Env:
  - `OPENROUTER_API_KEY` (required)
  - `OPENROUTER_MODEL` (optional default if request omits `model`)
- Example request (streams until done):
  - `curl -N -X POST http://localhost:3001/api/v1/chat/completions \
     -H 'Content-Type: application/json' \
     -d '{"messages":[{"role":"user","content":"Hello!"}]}'`

Persistence
- Table: `chat_logs` created on startup if missing.
- Stores two rows per interaction when possible:
  - `direction='request'` with the incoming payload (in `meta`) and concatenated user message text (in `content`).
  - `direction='response'` with the streamed assistant text in `content` and upstream status in `meta`.
- Field `session_id` comes from request body `session_id` or an auto-generated ID.


Notes
- The server loads env from the repo root `.env` first, then `backend/.env` if present (for backwards compatibility).
- If connecting to a managed Postgres that enforces TLS, set `PGSSL=true` in `.env`.
