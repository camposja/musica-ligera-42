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

Search uses the Spotify [Client Credentials Flow](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow) (no user auth needed). **Playlist import requires OAuth Authorization Code** — the Spotify [Web API change of Nov 27 2024](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api) removed Client-Credentials access to playlist endpoints for apps in Development Mode.

**Singleton OWNER connection model.** The OWNER connects once via the dashboard; all imports (including those triggered by USER sessions) use that connection. USERs never go through Spotify OAuth themselves. If the OWNER reconnects with a different Spotify account, every USER's imports use that new account.

**Required env** (already in `.env.example`):
- `SPOTIFY_CLIENT_ID` — from your app at https://developer.spotify.com/dashboard
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/spotify/callback`

**One-time Spotify Dashboard setup**: open your app at https://developer.spotify.com/dashboard → Edit Settings → **Redirect URIs** → add `http://127.0.0.1:3000/api/spotify/callback` *exactly* (no trailing slash) → Save.

⚠️ **Spotify rejects `http://localhost` as "not secure"** (policy change in 2024). Use the literal loopback IP `127.0.0.1` in **all three places**: `.env`, the Spotify Dashboard, and the browser URL you visit when testing (`http://127.0.0.1:3000`, not `http://localhost:3000`). If you mix the two, the OAuth state cookie won't travel between connect and callback and you'll see "Missing OAuth state cookie". `https://` URLs are also accepted (with a real cert), but for local dev `http://127.0.0.1` is what works.

**Connect flow**: sign in as OWNER → click "Connect Spotify" in the header → approve on Spotify's screen → land back on `/dashboard?spotify=connected`. The header now shows "Spotify: Connected" with a Disconnect link.

Scopes requested: `playlist-read-private playlist-read-collaborative`. We deliberately skip `user-read-private` — we don't display the Spotify profile, and the Spotify user `id` is in the public profile subset returned by `/v1/me`.

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/api/spotify/search?q=...` | session | Client-Credentials search; normalized track results; **does not persist** |
| GET | `/api/spotify/connect` | OWNER | redirects to Spotify authorize URL; sets short-lived signed `ml42_spotify_oauth_state` cookie for CSRF |
| GET | `/api/spotify/callback` | OWNER | verifies state cookie (cleared on every exit), exchanges code for tokens, stores singleton `SpotifyConnection` row, redirects `/dashboard?spotify=connected\|forbidden\|error` |
| POST | `/api/spotify/disconnect` | OWNER | deletes the singleton `SpotifyConnection` row |
| GET | `/api/spotify/status` | session | returns `{connected, spotifyUserId}` — never returns tokens |
| POST | `/api/spotify/import-playlist` | session + effective user | body `{url}` (open.spotify.com URL, `spotify:playlist:` URI, or 22-char id); uses the OWNER's stored token (refreshing if needed). Creates a Playlist for the effective user, upserts each Song by `spotifyId`, links them in Spotify order. Returns `{playlist, songsImported, songsReused}` on 201. |

Search results: `{spotifyId, title, artist, album, durationMs, albumImageUrl}` (multiple artists joined with `, `). Search returns 502 for upstream errors and 503 (with `Retry-After`) on rate limit.

### Import error mapping

`POST /api/spotify/import-playlist` returns a stable `code` field on every error response so the UI can render specific inline messages instead of a generic banner:

| HTTP | `code` | Meaning |
|---|---|---|
| 409 | `not_connected` | No `SpotifyConnection` row. Body includes `connectUrl: "/api/spotify/connect"`. UI: prompt OWNER to connect, tell USER to ask the OWNER. |
| 409 | `reconnect_required` | Refresh token rejected by Spotify (`invalid_grant`); the row was deleted automatically. Same UI prompt. |
| 404 | `playlist_not_found_or_private` | Spotify returned 404 — playlist doesn't exist or isn't visible to the connected account. |
| 403 | `spotify_restricted` | Spotify returned 403 — typically Spotify-owned editorial / algorithmic playlists. **OAuth does not unlock these for Development-Mode apps.** Use a user-created playlist. |
| 503 | `rate_limited` | Spotify returned 429. `Retry-After` header passed through. |
| 502 | `upstream` | Other upstream Spotify errors. |

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

### Import a (user-created public) playlist

```sh
curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"url":"https://open.spotify.com/playlist/<user-created-id>"}' \
  http://localhost:3000/api/spotify/import-playlist
# → 201 { playlist: {id, name}, songsImported: N, songsReused: M }
# → 409 { code: "not_connected", connectUrl: "/api/spotify/connect", ... } if no OAuth connection
# → 403 { code: "spotify_restricted", ... } for editorial / algorithmic playlists
```

Imported songs start with `youtubeId: null`; YouTube auto-match runs in the background after the response (see below). Importing the same playlist twice creates a second local playlist (per spec, playlists are not deduped, only songs are).

### Caveats and security debt

- **Editorial / algorithmic Spotify playlists** (`open.spotify.com/playlist/37i9dQZF1...` — "Today's Top Hits" etc.) **may still fail post-OAuth.** The Nov 2024 change restricted them at the API level for Development-Mode apps regardless of auth flow. Use a user-created public playlist to verify.
- **Tokens are stored plaintext in Postgres.** Acceptable for a local MVP; encrypt at rest before any production deploy (future work — derive a key from `SESSION_SECRET`).
- **Refresh-token death is handled.** If Spotify returns `invalid_grant` on refresh, the singleton `SpotifyConnection` row is deleted and the next import returns `409 reconnect_required`. The UI prompts the OWNER to reconnect.
- **Per-USER Spotify connections** are explicit non-goals for now. The dead `User.spotifyUserId` column from Ticket 1 will be removed in a separate migration.

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

Component at `src/components/YouTubePlayer.tsx`. Renders a plain YouTube embed `<iframe>`. Returns `null` for null/empty/malformed `videoId` so an unmatched song doesn't paint a broken iframe. Wired into the persistent player bar in `(app)/layout.tsx`.

## Frontend / pages

Dark-first UI, no theme toggle. Built with Tailwind v4 + native HTML + React Context — no UI libraries, no global state libs.

| Route | Auth | What it does |
|---|---|---|
| `/` | none | Redirects to `/dashboard` (with session) or `/login` (without). |
| `/login` | none | OWNER + USER login form (toggle). |
| `/dashboard` | session | Lists effective user's playlists; create-playlist + Spotify-import forms. OWNER without an acting USER sees a "Pick a user to start" prompt — use the header switcher. |
| `/playlist/[id]` | session + ownership | Songs in playlist order. ▶ Play sets the persistent bottom player. Songs whose YouTube auto-match hasn't completed yet show a disabled "Matching…" button + helper text. Remove deletes the join row (the song stays in the global library). |
| `/search` | session | "Search Spotify". Results have **Save** (adds to global library) and an **+ Add to playlist…** dropdown. Duplicates are surfaced inline ("Already in this playlist"); upstream errors stay inline ("Spotify upstream error"). |

Persistent header includes nav (Dashboard/Search), user identity, and — for OWNER sessions — a user switcher that calls `POST /api/auth/switch-user`. Persistent bottom player bar lives in `(app)/layout.tsx` so playback continues across page navigation.

### Manual smoke test

1. Visit http://localhost:3000 → redirects to `/login`.
2. Sign in as USER (e.g. alice) → land on `/dashboard`.
3. Create a playlist with the form on the dashboard.
4. Click "Search" in the nav, search for a song.
5. Use **+ Add to playlist…** to add a result to your playlist.
6. Click into the playlist; press ▶ Play on a song. The player bar at the bottom plays the YouTube embed and persists when you navigate to other pages.
7. Sign in as OWNER → confirm the "Pick a user to start" prompt + the user switcher dropdown in the header.

## Tests

```bash
pnpm test          # one-shot
pnpm test:watch    # watch mode
```

Vitest runs against a separate `music_app_test` Postgres database in the same Docker container. Global setup creates the DB if missing and applies migrations. Each test truncates all tables in `beforeEach`, so dev data in `music_app` is never touched.

`tests/helpers.ts` mocks `next/headers` cookies with an in-memory store so route handlers can be invoked directly with constructed `Request` objects — no need to spin up a real Next server.
