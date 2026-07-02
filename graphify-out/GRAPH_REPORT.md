# Graph Report - musica-ligera-42  (2026-07-02)

## Corpus Check
- 159 files · ~76,199 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 947 nodes · 1945 edges · 57 communities (47 shown, 10 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ad1a579c`
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
- [[_COMMUNITY_Community 23|Community 23]]
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
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]

## God Nodes (most connected - your core abstractions)
1. `getSession()` - 61 edges
2. `unauthorized()` - 54 edges
3. `forbidden()` - 38 edges
4. `effectiveUserId()` - 21 edges
5. `ApiError` - 18 edges
6. `apiFetch()` - 18 edges
7. `setUserSession()` - 17 edges
8. `GET()` - 17 edges
9. `compilerOptions` - 16 edges
10. `truncateAll()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `setSession()` --calls--> `signSession()`  [EXTRACTED]
  tests/helpers.ts → src/lib/session.ts
- `enablePiped()` --calls--> `resetPlaybackProvidersForTests()`  [EXTRACTED]
  tests/youtube-audio.test.ts → src/lib/playback/resolver.ts
- `diagnose()` --calls--> `pickBestMatch()`  [EXTRACTED]
  scripts/diag-match.ts → src/lib/youtube-match.ts
- `diagnose()` --calls--> `scoreCandidate()`  [EXTRACTED]
  scripts/diag-match.ts → src/lib/youtube-match.ts
- `GET()` --calls--> `rankSongs()`  [INFERRED]
  src/app/api/youtube/search/route.ts → src/lib/library-search.ts

## Communities (57 total, 10 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.11
Nodes (30): isStatus(), lookup(), prune(), record(), Status, toLookup(), TTL_MS, bestMatch() (+22 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (61): Ctx, POST(), Home(), Ctx, POST(), POST(), Ctx, DELETE() (+53 more)

### Community 2 - "Community 2"
Cohesion: 0.14
Nodes (15): clearCookies(), ctx(), mockCookieStore, ParamCtx, setOwnerActingSession(), setOwnerSession(), setSession(), setUserSession() (+7 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (40): cache, createMoovPatchTransform(), evictAudioCache(), getPlaybackProviders(), resetPlaybackProvidersForTests(), resolveAudio(), MoovPatchState, PlaybackProvider (+32 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (36): importAutoMatchLimit(), POST(), spotifyErrorResponse(), EmbedTrack, findKey(), getPlaylistFromEmbed(), normalizeEmbedTrack(), PlaylistNotVisibleError (+28 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (48): RankablePlaylist, RankableSong, rankPlaylists(), rankSongs(), scorePlaylist(), scoreSong(), tier(), tokenCoverage() (+40 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (32): dependencies, better-sqlite3, jose, next, @prisma/adapter-better-sqlite3, @prisma/client, react, react-dom (+24 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (27): AudioError, AudioStatus, LyricsUiState, PlayerBar(), Ctx, EMPTY, PlayerCtx, PlayerProvider() (+19 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (26): Already captured / not a separate ticket, API authorization changes, Cache model, code:ts (type LyricsResponse =), code:prisma (model LyricsCache {), code:sh (pnpm exec tsc --noEmit), code:sh (graphify update .), Context (+18 more)

### Community 9 - "Community 9"
Cohesion: 0.18
Nodes (13): AddToPlaylistMenu(), PlaylistOption, Props, Status, PlaylistOption, PlayStatus, Props, SaveStatus (+5 more)

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (14): ClonePlaylistButton(), Props, Status, UserOption, CreatePlaylistForm(), DeletePlaylistButton(), Props, FindMissingMatchesButton() (+6 more)

### Community 11 - "Community 11"
Cohesion: 0.06
Nodes (49): chain, fetchVideoDetails(), filterEmbeddableIds(), flushPendingMatches(), getApiKey(), isQuotaExhaustionReason(), MatchOutcome, parseIsoDuration() (+41 more)

### Community 12 - "Community 12"
Cohesion: 0.1
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 13 - "Community 13"
Cohesion: 0.16
Nodes (13): CandidateRow(), formatDuration(), parseMetadata(), PickYoutubeMatchModal(), Props, useNowPlaying(), ResultRow(), friendlyOverrideError() (+5 more)

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
Cohesion: 0.11
Nodes (21): LibrarySearchResults(), Props, Props, RecentSearches(), Props, SearchBar(), LoadState, PlaylistOption (+13 more)

### Community 18 - "Community 18"
Cohesion: 0.2
Nodes (5): Mode, isTruthy(), LoginPage(), metadata, Search

### Community 19 - "Community 19"
Cohesion: 0.18
Nodes (10): Adding a manual song to a playlist (two-step flow), code:bash (pnpm test          # one-shot), Frontend / pages, Layout, Manual smoke test, Música Ligera 42, Package manager, Playlists & songs API (+2 more)

### Community 20 - "Community 20"
Cohesion: 0.1
Nodes (20): Context, Existing implementation to inspect, Expected behavior, Final verification, Goal, Goal, Hard guardrails, Implementation ideas to evaluate (+12 more)

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (7): code:bash (pnpm install                    # installs deps + builds bet), code:bash (pnpm switch-env auto              # detect current branch), code:bash (scripts/install-branch-env-hook.sh), code:bash (unset DATABASE_URL), code:bash (pnpm install && pnpm prisma generate), Dev quickstart, Switching DB branches locally

### Community 22 - "Community 22"
Cohesion: 0.29
Nodes (7): Caveats and security debt, code:sh (# 1. Search), code:sh (curl -b cookies.txt -H 'Content-Type: application/json' \), Import a (user-created public) playlist, Import error mapping, Save-a-search-result flow (two steps), Spotify integration

### Community 23 - "Community 23"
Cohesion: 0.11
Nodes (17): code:ts (import type { Session } from "@/lib/session";), code:sh (graphify update .), code:sh (pnpm exec tsc --noEmit), Commit guidance, Context, Current state to respect, Deliverable, Deliverable (+9 more)

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

### Community 45 - "Community 45"
Cohesion: 0.33
Nodes (11): clearHistory(), deleteSearch(), isSearchSurface(), listRecent(), recordSearch(), SEARCH_SURFACES, normalizeQuery(), DELETE() (+3 more)

### Community 47 - "Community 47"
Cohesion: 0.1
Nodes (26): appUrl(), GET(), GET(), buildAuthorizeUrl(), clearOauthStateCookie(), exchangeCodeForToken(), getAllPlaylistTracksAsConnection(), getJwtSecret() (+18 more)

### Community 48 - "Community 48"
Cohesion: 0.4
Nodes (4): DONE, Side Bar: iOS-specific or lower-value for web, TODO, Web/iOS Parity Master List

### Community 49 - "Community 49"
Cohesion: 0.14
Nodes (28): applyPatchToChunk(), boxType(), CONTAINERS, durationFieldOffsets(), moovEndIfTruncated(), topLevelBox(), u32(), ver0DurationOffset() (+20 more)

### Community 50 - "Community 50"
Cohesion: 0.1
Nodes (10): candA, candAVideos, candB, candC, fetchSpy, matchPair(), MockedResponse, searchResp() (+2 more)

### Community 51 - "Community 51"
Cohesion: 0.14
Nodes (14): Header(), Props, HeaderMenu(), Props, ErrorView, ImportPlaylistForm(), SessionContext, SessionProvider() (+6 more)

### Community 52 - "Community 52"
Cohesion: 0.27
Nodes (10): PlaylistList(), Props, DashboardPage(), SpotifyBanner, Params, PlaylistPage(), getEffectiveUserIdOrNull(), getRequiredSession() (+2 more)

### Community 53 - "Community 53"
Cohesion: 0.22
Nodes (7): formatRemaining(), KeepAliveButton(), Stored, nextPingDelay(), retryDelay(), d, hi

### Community 54 - "Community 54"
Cohesion: 0.17
Nodes (7): emptyRequest(), jsonRequest(), deleteReq(), buildEmbedHtml(), embedTracks, MockedResponse, mockEmbedResponse()

### Community 55 - "Community 55"
Cohesion: 0.27
Nodes (7): AppLayout(), Settings, SettingsForm(), Status, AppSettings, getAppSettings(), SettingsPage()

## Knowledge Gaps
- **327 isolated node(s):** `config`, `name`, `version`, `private`, `packageManager` (+322 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getSession()` connect `Community 1` to `Community 3`, `Community 4`, `Community 11`, `Community 45`, `Community 47`, `Community 52`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `unauthorized()` connect `Community 1` to `Community 3`, `Community 4`, `Community 11`, `Community 45`, `Community 47`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `truncateAll()` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`, `Community 11`, `Community 45`, `Community 47`, `Community 50`, `Community 54`, `Community 56`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **What connects `config`, `name`, `version` to the rest of the system?**
  _327 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.14 - nodes in this community are weakly interconnected._