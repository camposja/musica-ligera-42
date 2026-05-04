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
| POST | `/api/songs` | session | body `{title, artist, album?, spotifyId?, youtubeId?, youtubeAltIds?}`. **Idempotent on `spotifyId`**: if a Song already exists with that `spotifyId`, the existing row is returned (200) and local fields are preserved. New rows return 201. Without `spotifyId` every call creates a new row. |

### Adding a manual song to a playlist (two-step flow)

`add-song` only accepts an existing `songId`. To attach a brand-new manual song:

1. `POST /api/songs` with `{title, artist, ...}` → returns `{song: {id, ...}}`
2. `POST /api/playlists/:id/add-song` with `{songId: <id from step 1>}`

This keeps song creation single-source and lets later tickets (Spotify import) reuse `POST /api/songs` cleanly.

## Spotify integration

Search the Spotify catalog and import public Spotify playlists. Uses the [Client Credentials Flow](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow) — no user-OAuth, so private playlists are out of scope.

**Required env** (already in `.env.example`):
- `SPOTIFY_CLIENT_ID` — from your app at https://developer.spotify.com/dashboard
- `SPOTIFY_CLIENT_SECRET`

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/api/spotify/search?q=...` | session | normalized track results; **does not persist** |
| POST | `/api/spotify/import-playlist` | session + effective user | body `{url}` (open.spotify.com URL, `spotify:playlist:` URI, or 22-char id); creates a Playlist for the effective user, upserts each Song by `spotifyId`, links them in Spotify order. Returns `{playlist, songsImported, songsReused}`. |

Search results are returned in this shape: `{spotifyId, title, artist, album, durationMs, albumImageUrl}`. Multiple artists are joined with `, `. The endpoint returns 502 for upstream Spotify errors and 503 (with `Retry-After` header passed through) on rate limiting.

### Save-a-search-result flow (two steps)

```sh
# 1. Search
curl -b cookies.txt 'http://localhost:3000/api/spotify/search?q=hello%20adele'
# → { tracks: [{ spotifyId: "...", title: "Hello", artist: "Adele", ... }] }

# 2. Save the one you want — POST /api/songs is idempotent on spotifyId
curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"title":"Hello","artist":"Adele","spotifyId":"...","album":"25"}' \
  http://localhost:3000/api/songs
```

### Import a public playlist

```sh
curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"url":"https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"}' \
  http://localhost:3000/api/spotify/import-playlist
# → { playlist: {id, name}, songsImported: N, songsReused: M }
```

Imported songs start with `youtubeId: null`; YouTube auto-match runs in the background after the response (see below). Importing the same playlist twice creates a second local playlist (per spec, playlists are not deduped, only songs are).

## YouTube playback

Songs are matched to YouTube videos via the [YouTube Data API v3 search endpoint](https://developers.google.com/youtube/v3/docs/search/list). The top result becomes `Song.youtubeId`; the next 2–3 are stored in `Song.youtubeAltIds` for later override.

**Required env** (already in `.env.example`):
- `YOUTUBE_API_KEY` — get one at https://console.cloud.google.com/ (enable "YouTube Data API v3" on the project)

**Default daily quota is 10,000 units; each search costs 100 units (~100 matches/day).** Plan accordingly.

| Method | Path | Auth | Behavior |
|---|---|---|---|
| POST | `/api/youtube/match` | OWNER-only | body `{songId}`. Re-runs YouTube search and overwrites `youtubeId` + `youtubeAltIds`. 404 with `{error:"No YouTube match found"}` when search returns 0 items. 503 + `Retry-After` on 429. 502 on other upstream errors. |
| POST | `/api/youtube/override` | OWNER-only | body `{songId, newYoutubeId}`. Format-validates `newYoutubeId` against `^[A-Za-z0-9_-]{11}$`. Updates `youtubeId` only; `youtubeAltIds` is untouched. **No call to YouTube** — saves quota. |

**Why OWNER-only:** `Song` is global shared state — every user with a song in their playlist plays the same `youtubeId`. A USER changing it would affect every other user, so manual mutation is locked to OWNER. Auto-match is fine for any session because it only fills `youtubeId` when it's null; it never overwrites an existing pick.

### Auto-match (fire-and-forget)

When a Song is created via `POST /api/songs` (without an explicit `youtubeId`) or via `POST /api/spotify/import-playlist`, a background match runs **after** the HTTP response is sent. Matches are processed serially (concurrency 1) via a chained promise; errors are logged and swallowed. Failed/quota-blocked songs stay `youtubeId: null` and can be retried later via `POST /api/youtube/match`.

**Per-import cap: 25 songs.** A 100-track Spotify import will only auto-match the first 25 songs that need it; the rest stay unmatched until you trigger them manually. This bounds quota burn (≤2,500 units/import) so a single click can't wipe the daily budget.

> ⚠️ **MVP / local-server only.** Fire-and-forget works on `pnpm dev` / `next start` because the Node process keeps running. It will **not** work on serverless deployments (Vercel functions, AWS Lambda) — those terminate execution once the response is sent. Replace with a real durable queue (BullMQ, pg-boss, Cloud Tasks) before deploying serverlessly.

### `<YouTubePlayer videoId={...} />`

Component at `src/components/YouTubePlayer.tsx`. Renders a plain YouTube embed `<iframe>`. Returns `null` for null/empty/malformed `videoId` so an unmatched song doesn't paint a broken iframe. Wired into actual pages in Ticket 5.

## Tests

```bash
pnpm test          # one-shot
pnpm test:watch    # watch mode
```

Vitest runs against a separate `music_app_test` Postgres database in the same Docker container. Global setup creates the DB if missing and applies migrations. Each test truncates all tables in `beforeEach`, so dev data in `music_app` is never touched.

`tests/helpers.ts` mocks `next/headers` cookies with an in-memory store so route handlers can be invoked directly with constructed `Request` objects — no need to spin up a real Next server.
