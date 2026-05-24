# Graph Report - musica-ligera-42  (2026-05-24)

## Corpus Check
- 127 files · ~57,409 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 724 nodes · 1504 edges · 44 communities (36 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7e24fae1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]

## God Nodes (most connected - your core abstractions)
1. `getSession()` - 56 edges
2. `unauthorized()` - 49 edges
3. `forbidden()` - 34 edges
4. `ApiError` - 18 edges
5. `apiFetch()` - 17 edges
6. `effectiveUserId()` - 17 edges
7. `compilerOptions` - 16 edges
8. `searchYoutube()` - 14 edges
9. `getQuotaStatus()` - 13 edges
10. `devDependencies` - 12 edges

## Surprising Connections (you probably didn't know these)
- `setSession()` --calls--> `signSession()`  [EXTRACTED]
  tests/helpers.ts → src/lib/session.ts
- `makeUserSession()` --calls--> `setUserSession()`  [EXTRACTED]
  tests/youtube-audio.test.ts → tests/helpers.ts
- `enablePiped()` --calls--> `resetPlaybackProvidersForTests()`  [EXTRACTED]
  tests/youtube-audio.test.ts → src/lib/playback/resolver.ts
- `diagnose()` --calls--> `pickBestMatch()`  [EXTRACTED]
  scripts/diag-match.ts → src/lib/youtube-match.ts
- `diagnose()` --calls--> `scoreCandidate()`  [EXTRACTED]
  scripts/diag-match.ts → src/lib/youtube-match.ts

## Communities (44 total, 8 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (63): normalizeSong(), parseAltIds(), serializeAltIds(), chain, fetchVideoDetails(), filterEmbeddableIds(), flushPendingMatches(), getApiKey() (+55 more)

### Community 1 - "Community 1"
Cohesion: 0.1
Nodes (38): Ctx, POST(), Home(), Ctx, POST(), POST(), Ctx, DELETE() (+30 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (38): clearSessionCookie(), getSecret(), isSession(), readSessionCookie(), setSessionCookie(), signSession(), verifySessionToken(), POST() (+30 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (28): cache, evictAudioCache(), getPlaybackProviders(), resetPlaybackProvidersForTests(), resolveAudio(), PlaybackProvider, PlaybackStream, ProviderName (+20 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (35): importAutoMatchLimit(), POST(), spotifyErrorResponse(), EmbedTrack, findKey(), getPlaylistFromEmbed(), normalizeEmbedTrack(), PlaylistNotVisibleError (+27 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (39): Candidate, contentTokens(), COVER_PATTERNS, coverage(), detectReason(), HARD_REJECT_PATTERNS, intersects(), MatchResult (+31 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (32): dependencies, better-sqlite3, jose, next, @prisma/adapter-better-sqlite3, @prisma/client, react, react-dom (+24 more)

### Community 7 - "Community 7"
Cohesion: 0.15
Nodes (17): Ctx, EMPTY, PlayerCtx, PlayerProvider(), State, clampIndex(), Identified, nextIndex() (+9 more)

### Community 8 - "Community 8"
Cohesion: 0.13
Nodes (24): appUrl(), GET(), GET(), buildAuthorizeUrl(), clearOauthStateCookie(), exchangeCodeForToken(), getAllPlaylistTracksAsConnection(), getJwtSecret() (+16 more)

### Community 9 - "Community 9"
Cohesion: 0.2
Nodes (12): AddToPlaylistMenu(), PlaylistOption, Props, Status, PlaylistOption, PlayStatus, Props, SaveStatus (+4 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (45): AppLayout(), ClonePlaylistButton(), Props, Status, UserOption, CreatePlaylistForm(), DeletePlaylistButton(), Props (+37 more)

### Community 11 - "Community 11"
Cohesion: 0.2
Nodes (7): AudioError, AudioStatus, PlayerBar(), Props, YouTubeAudioPlayer(), Props, getNextPlayableYoutubeId()

### Community 12 - "Community 12"
Cohesion: 0.1
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (14): CandidateRow(), formatDuration(), parseMetadata(), PickYoutubeMatchModal(), Props, useNowPlaying(), ResultRow(), friendlyOverrideError() (+6 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (15): Adding a USER row in production, Boot: `bin/docker-entrypoint`, code:bash (# 1. From main with all deploy files committed.), code:bash (docker build -t musica-ligera-42 .), code:bash (fly status                                       # health + ), code:sh (sqlite3 /data/musica-ligera.sqlite \), Deploy (Fly.io + persistent SQLite), First-deploy verification checklist (+7 more)

### Community 15 - "Community 15"
Cohesion: 0.17
Nodes (12): Architecture (provider layer), Auto-match (fire-and-forget), Caveats, code:bash (brew install yt-dlp), code:bash (which yt-dlp), Components, Error codes, Install yt-dlp (+4 more)

### Community 16 - "Community 16"
Cohesion: 0.24
Nodes (9): CopyStatus, formatDuration(), parseYoutubeMetadata(), PlaylistOption, Props, ResultRow(), SaveStatus, songPayloadFromYoutube() (+1 more)

### Community 17 - "Community 17"
Cohesion: 0.22
Nodes (7): Props, SearchBar(), LoadState, PlaylistOption, Props, QuotaStatus, SearchResponse

### Community 18 - "Community 18"
Cohesion: 0.2
Nodes (5): Mode, isTruthy(), LoginPage(), metadata, Search

### Community 19 - "Community 19"
Cohesion: 0.18
Nodes (10): Adding a manual song to a playlist (two-step flow), code:bash (pnpm test          # one-shot), Frontend / pages, Layout, Manual smoke test, Música Ligera 42, Package manager, Playlists & songs API (+2 more)

### Community 20 - "Community 20"
Cohesion: 0.2
Nodes (9): PlaylistList(), Props, ListPlaylistsResponse, MeResponse, PlaylistResponse, PlaylistSource, PlaylistWithCount, PlaylistWithSongs (+1 more)

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (7): code:bash (pnpm install                    # installs deps + builds bet), code:bash (pnpm switch-env auto              # detect current branch), code:bash (scripts/install-branch-env-hook.sh), code:bash (unset DATABASE_URL), code:bash (pnpm install && pnpm prisma generate), Dev quickstart, Switching DB branches locally

### Community 22 - "Community 22"
Cohesion: 0.29
Nodes (7): Caveats and security debt, code:sh (# 1. Search), code:sh (curl -b cookies.txt -H 'Content-Type: application/json' \), Import a (user-created public) playlist, Import error mapping, Save-a-search-result flow (two steps), Spotify integration

### Community 24 - "Community 24"
Cohesion: 0.4
Nodes (3): geistMono, geistSans, metadata

### Community 25 - "Community 25"
Cohesion: 0.5
Nodes (4): Auth API surface, Auth — local test setup, code:sh (sqlite3 dev.db \), code:sh (curl -c cookies.txt -H 'Content-Type: application/json' \)

### Community 26 - "Community 26"
Cohesion: 0.67
Nodes (3): applyMigrations(), setup(), TEST_DB_PATH

### Community 30 - "Community 30"
Cohesion: 0.67
Nodes (3): Backups, code:bash (fly volumes list                                  # find <vo), code:bash (fly ssh console -C "/usr/local/bin/backup-db"     # writes /)

## Knowledge Gaps
- **239 isolated node(s):** `config`, `name`, `version`, `private`, `packageManager` (+234 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getSession()` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 8`, `Community 10`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Why does `isValidYoutubeId()` connect `Community 7` to `Community 0`, `Community 11`, `Community 3`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `unauthorized()` connect `Community 1` to `Community 0`, `Community 8`, `Community 3`, `Community 4`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `config`, `name`, `version` to the rest of the system?**
  _239 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._