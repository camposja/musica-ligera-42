# Música Ligera 42

A music app built on Next.js + PostgreSQL + Prisma. Spotify search and playlist import, YouTube playback.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4
- PostgreSQL 15 (via Docker Compose)
- Prisma 7

## Dev quickstart

```bash
docker compose up -d            # start Postgres on host port 5433
pnpm install                    # install deps
cp .env.example .env            # then fill in .env (see below)
pnpm prisma migrate deploy      # apply existing migrations
pnpm dev                        # http://localhost:3000
```

`.env` keys you must set locally:

- `OWNER_USERNAME` and `OWNER_PASSWORD` — the OWNER login credentials
- `SESSION_SECRET` — generate with `openssl rand -hex 32`

## Layout

- `src/app/` — Next.js app router (pages + API routes under `src/app/api/`)
- `src/lib/prisma.ts` — Prisma client singleton
- `src/lib/session.ts` — cookie/JWT primitives
- `src/lib/auth.ts` — `getSession()` + 401/403 helpers
- `prisma/schema.prisma` — data model
- `docker-compose.yml` — Postgres service

## Auth — local test setup

OWNER login uses env credentials; USER login validates `name` + `accessCode` against the `User` table.

To verify the USER login flow, **manually insert** one test user via psql (no seed file, no CLI — that's deliberate):

```sh
docker compose exec -T db psql -U postgres -d music_app -c \
  "INSERT INTO \"User\" (id, name, role, \"accessCode\", \"createdAt\") \
   VALUES (gen_random_uuid(), 'alice', 'USER', 'letmein', NOW());"
```

Then sign in at [http://localhost:3000/login](http://localhost:3000/login) (toggle "User", enter `alice` / `letmein`) or via curl:

```sh
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"type":"USER","name":"alice","accessCode":"letmein"}' \
  http://localhost:3000/api/auth/login

curl -b cookies.txt http://localhost:3000/api/auth/me
```

### Auth API surface

| Method | Path | Auth required | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | none | body `{type:"OWNER", username, password}` or `{type:"USER", name, accessCode}` |
| POST | `/api/auth/logout` | none | clears cookie |
| GET | `/api/auth/me` | session | returns `{role, ...}`; 401 if no session |
| POST | `/api/auth/switch-user` | OWNER | body `{userId}`; sets `actingUserId` on the OWNER session |
| GET | `/api/users` | OWNER | excludes `accessCode` from the response |

## Playlists & songs API

All playlist endpoints require an **effective user** — either a USER session OR an OWNER session that has switched into a user via `/api/auth/switch-user`. An OWNER without `actingUserId` gets `403 Forbidden`. Songs are a global library and are readable/writable by any authenticated session.

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/api/playlists` | session + effective user | list effective user's playlists with song count |
| POST | `/api/playlists` | session + effective user | body `{name}` → creates playlist owned by effective user |
| GET | `/api/playlists/:id` | session + effective user + ownership | playlist + ordered songs; 403 if not yours |
| DELETE | `/api/playlists/:id` | session + effective user + ownership | deletes playlist + join rows; **songs persist** |
| POST | `/api/playlists/:id/add-song` | session + effective user + ownership | body `{songId}` (existing song id only) |
| POST | `/api/playlists/:id/remove-song` | session + effective user + ownership | body `{songId}` |
| GET | `/api/songs` | session | global library |
| POST | `/api/songs` | session | body `{title, artist, album?, spotifyId?, youtubeId?, youtubeAltIds?}`; 409 on duplicate `spotifyId` |

### Adding a manual song to a playlist (two-step flow)

`add-song` only accepts an existing `songId`. To attach a brand-new manual song:

1. `POST /api/songs` with `{title, artist, ...}` → returns `{song: {id, ...}}`
2. `POST /api/playlists/:id/add-song` with `{songId: <id from step 1>}`

This keeps song creation single-source and lets later tickets (Spotify import) reuse `POST /api/songs` cleanly.

## Tests

```bash
pnpm test          # one-shot
pnpm test:watch    # watch mode
```

Vitest runs against a separate `music_app_test` Postgres database in the same Docker container. Global setup creates the DB if missing and applies migrations. Each test truncates all tables in `beforeEach`, so dev data in `music_app` is never touched.

`tests/helpers.ts` mocks `next/headers` cookies with an in-memory store so route handlers can be invoked directly with constructed `Request` objects — no need to spin up a real Next server.
