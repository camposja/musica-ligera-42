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

**Search** uses the Spotify [Client Credentials Flow](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow) (no user auth needed).

**Playlist import scrapes the public `open.spotify.com/embed/playlist/{id}` iframe** instead of using the official Web API. Reason: the [Nov 27 2024 Spotify Web API change](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api) blocks `/playlists/{id}/tracks` for apps in Development Mode — even with OAuth, even for the user's own playlists. The embed page is what Spotify hands out for blog/site embeds and contains a `__NEXT_DATA__` JSON blob with the full track list (title, artist, spotifyId, duration). No auth required, no Spotify Dashboard registration ceremony, no per-user allowlist. The trade-off: it's not a stable contract — if Spotify changes the embed page structure, the parser in `src/lib/spotify-embed.ts` will need an update. Album name and per-track cover art aren't in the embed payload (only the playlist cover); search results still carry full metadata since search uses the official API.

**OAuth Authorization Code** (`/connect`, `/callback`, `/disconnect`, `/status`) is still wired up and the `SpotifyConnection` table still exists — useful for future features that need user-private data (e.g. "import my private Spotify playlists" or "edit a playlist back to Spotify"). The import flow doesn't depend on it. Connecting in the header populates the Spotify-account badge so the OWNER can see which account is connected, which is mostly cosmetic right now.

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
| POST | `/api/spotify/import-playlist` | session + effective user | body `{url}` (open.spotify.com URL, `spotify:playlist:` URI, or 22-char id); scrapes the public Spotify embed iframe for the track list. Creates a Playlist for the effective user, upserts each Song by `spotifyId`, links them in Spotify order. Returns `{playlist, songsImported, songsReused}` on 201. **Does not require an OAuth connection.** |

Search results: `{spotifyId, title, artist, album, durationMs, albumImageUrl}` (multiple artists joined with `, `). Search returns 502 for upstream errors and 503 (with `Retry-After`) on rate limit.

### Import error mapping

`POST /api/spotify/import-playlist` returns a stable `code` field on every error response so the UI can render specific inline messages instead of a generic banner:

| HTTP | `code` | Meaning |
|---|---|---|
| 404 | `playlist_not_visible_or_private` | The Spotify embed page didn't include a `trackList` (or returned malformed JSON). Usually means private, region-locked, or recently deleted playlist. |
| 503 | `rate_limited` | Embed endpoint rate-limited us. `Retry-After` header passed through. |
| 502 | `upstream` | Other upstream Spotify errors (5xx from the embed endpoint). |

The OAuth-specific codes (`not_connected`, `reconnect_required`, `playlist_not_found_or_private`, `spotify_restricted`) are still defined in the route but won't fire from the embed-based import path. They're kept for any future OAuth-backed import code path.

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

- **Embed scraping is unofficial.** The parser in `src/lib/spotify-embed.ts` reads the `__NEXT_DATA__` JSON from `https://open.spotify.com/embed/playlist/{id}`. Spotify could change this structure at any time and the import would break — the fallback would need a code update. (Editorial playlists like "Today's Top Hits" *do* work via this path; tested with `37i9dQZF1DXcBWIGoYBM5M`.)
- **Imported songs lose album name and per-track cover art** — those fields aren't in the embed payload. Search results still carry them since search uses the official API.
- **OAuth tokens (when connected) are stored plaintext in Postgres.** Acceptable for a local MVP; encrypt at rest before any production deploy (future work — derive a key from `SESSION_SECRET`).
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
| GET  | `/api/youtube/audio/[videoId]` | session | Streams audio extracted from YouTube via `youtubei.js` (InnerTube). Forwards the browser's `Range` header upstream (so `<audio>` seeking works → 206 Partial Content). 1-hour in-memory cache of stream URLs. 502 with `{error:"extraction_failed"}` if extraction fails. **No quota cost** — bypasses the YouTube Data API. |

**Why OWNER-only:** `Song` is global shared state — every user with a song in their playlist plays the same `youtubeId`. A USER changing it would affect every other user, so manual mutation is locked to OWNER. Auto-match is fine for any session because it only fills `youtubeId` when it's null; it never overwrites an existing pick.

### Auto-match (fire-and-forget)

When a Song is created via `POST /api/songs` (without an explicit `youtubeId`) or via `POST /api/spotify/import-playlist`, a background match runs **after** the HTTP response is sent. Matches are processed serially (concurrency 1) via a chained promise; errors are logged and swallowed. Failed/quota-blocked songs stay `youtubeId: null` and can be retried later via `POST /api/youtube/match`.

**Per-import cap: 25 songs.** A 100-track Spotify import will only auto-match the first 25 songs that need it; the rest stay unmatched until you trigger them manually. This bounds quota burn (≤2,500 units/import) so a single click can't wipe the daily budget.

> ⚠️ **MVP / local-server only.** Fire-and-forget works on `pnpm dev` / `next start` because the Node process keeps running. It will **not** work on serverless deployments (Vercel functions, AWS Lambda) — those terminate execution once the response is sent. Replace with a real durable queue (BullMQ, pg-boss, Cloud Tasks) before deploying serverlessly.

### Playback

**Primary: server-side audio extraction.** The player bar renders an `<audio src="/api/youtube/audio/[id]">` element. The route handler uses [`youtubei.js`](https://www.npmjs.com/package/youtubei.js) (a pure-JS client for YouTube's internal InnerTube API) to resolve a direct CDN URL for the audio-only stream, then proxies the bytes through to the browser. **No YouTube login required.** Format selection prefers `audio/mp4` (Safari can play AAC; it can't play YouTube's `audio/webm` opus), falling back to any container only when no mp4 audio-only format is available. Browser-native `<audio>` controls — play/pause/seek/volume — driven by `Range` request passthrough to YouTube's CDN.

> **Why proxy, not 302 redirect?** YouTube stream URLs are bound to the requesting IP. A redirect to that URL would 403 from the browser's IP. The proxy uses our server's bandwidth (fine for personal/family scale).

**Fallback: YouTube iframe.** If the `<audio>` element fires `onError` (extraction broke for that video, format incompatibility, etc.), `PlayerBar` swaps in `<YouTubePlayer>` — the original `https://www.youtube.com/embed/[id]` iframe. The iframe is gated by YouTube's anonymous-embed restrictions (most music videos require the visitor be signed into a YouTube account), so it's a *deepest* fallback, not a peer.

**Future: Spotify Web Playback SDK.** Captured as future work. When any one user has Spotify Premium connected (singleton OWNER model), we'd prefer the SDK over extraction for higher fidelity. Extraction stays the no-Premium-required path.

The auto-match filter still removes the *obviously* unplayable hits before they ever land in the DB — even though extraction sidesteps most of these, the filter helps the iframe-fallback case:
- Non-embeddable videos (uploader disabled third-party embedding entirely)
- Age-restricted videos (`contentDetails.contentRating.ytRating === "ytAgeRestricted"`)
- Private videos

If all 4 candidates from a search are restricted, we fall back to the search order so the song still has *some* match — extraction usually still works on these.

**For songs imported before the filter existed**, the OWNER can hit the "Re-check matches" button on the dashboard. It re-checks each song's stored `youtubeId + youtubeAltIds` (1 quota unit per song, no new searches) and promotes a playable alt if one exists.

#### Caveats

- **`youtubei.js` fragility.** Uses YouTube's reverse-engineered InnerTube API (Android client) instead of the signature-decipher path that broke `@distube/ytdl-core` for us in May 2026. More resilient historically, but still subject to YouTube changes — recovery is `pnpm update youtubei.js`. If extraction breaks for an extended period, the swap to a `yt-dlp` shell-out is a ~30-line change to `src/lib/youtube-audio.ts`. The iframe fallback covers signed-in YouTube users during the gap.
- **YouTube ToS gray area.** Extraction is unofficial. YouTube's TOS prohibits "downloading"; they have not pursued individual users in practice. For wider deployment this needs a re-evaluation.
- **Server bandwidth.** Audio streams scale with concurrent listeners. For 2–7 family users this is trivial.
- **Serverless deployment.** The streaming proxy assumes a long-running Node server. Vercel functions have a short streaming timeout — would need rework before deploying serverlessly.

#### Components

- `src/components/YouTubeAudioPlayer.tsx` — `"use client"` `<audio controls autoPlay>` against the proxy endpoint. Calls `onError` so `PlayerBar` can fall back.
- `src/components/YouTubePlayer.tsx` — `<iframe>` embed. Used as deepest fallback when extraction fails.
- `src/components/PlayerBar.tsx` — wires both: `YouTubeAudioPlayer` first; on error swaps to `YouTubePlayer`. Resets the failure flag when the song changes.

## Frontend / pages

Dark-first UI, no theme toggle. Built with Tailwind v4 + native HTML + React Context — no UI libraries, no global state libs.

| Route | Auth | What it does |
|---|---|---|
| `/` | none | Redirects to `/dashboard` (with session) or `/login` (without). |
| `/login` | none | OWNER + USER login form (toggle). |
| `/dashboard` | session | Lists effective user's playlists; create-playlist + Spotify-import forms. OWNER without an acting USER sees a "Pick a user to start" prompt — use the header switcher. |
| `/playlist/[id]` | session + ownership | Songs in playlist order. ▶ Play opens the persistent player strip just below the header. Songs whose YouTube auto-match hasn't completed yet show a disabled "Matching…" button + helper text. Remove deletes the join row (the song stays in the global library). |
| `/search` | session | "Search Spotify". Results have **Save** (adds to global library) and an **+ Add to playlist…** dropdown. Duplicates are surfaced inline ("Already in this playlist"); upstream errors stay inline ("Spotify upstream error"). |

Persistent header includes nav (Dashboard/Search), user identity, and — for OWNER sessions — a user switcher that calls `POST /api/auth/switch-user`. The header and the player strip share a single `sticky top-0` wrapper in `(app)/layout.tsx`, so both stay pinned while content scrolls. The player strip itself only appears when a song is loaded; closing it reflows the page.

### Manual smoke test

1. Visit http://localhost:3000 → redirects to `/login`.
2. Sign in as USER (e.g. alice) → land on `/dashboard`.
3. Create a playlist with the form on the dashboard.
4. Click "Search" in the nav, search for a song.
5. Use **+ Add to playlist…** to add a result to your playlist.
6. Click into the playlist; press ▶ Play on a song. The player strip appears below the header, plays the audio (extracted server-side via `/api/youtube/audio/[id]`), and persists across page navigation. Try it in an incognito window with no YouTube cookies — audio should still play.
7. Sign in as OWNER → confirm the "Pick a user to start" prompt + the user switcher dropdown in the header.

## Tests

```bash
pnpm test          # one-shot
pnpm test:watch    # watch mode
```

Vitest runs against a separate `music_app_test` Postgres database in the same Docker container. Global setup creates the DB if missing and applies migrations. Each test truncates all tables in `beforeEach`, so dev data in `music_app` is never touched.

`tests/helpers.ts` mocks `next/headers` cookies with an in-memory store so route handlers can be invoked directly with constructed `Request` objects — no need to spin up a real Next server.
