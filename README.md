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
