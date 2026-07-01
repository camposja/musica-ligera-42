# Graph Report - musica-ligera-42  (2026-07-01)

## Corpus Check
- 153 files · ~70,959 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 895 nodes · 1843 edges · 49 communities (40 shown, 9 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2236a100`
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
- `asUser()` --calls--> `setUserSession()`  [EXTRACTED]
  tests/lyrics.test.ts → tests/helpers.ts
- `makeUserSession()` --calls--> `setUserSession()`  [EXTRACTED]
  tests/youtube-audio.test.ts → tests/helpers.ts
- `enablePiped()` --calls--> `resetPlaybackProvidersForTests()`  [EXTRACTED]
  tests/youtube-audio.test.ts → src/lib/playback/resolver.ts
- `diagnose()` --calls--> `pickBestMatch()`  [EXTRACTED]
  scripts/diag-match.ts → src/lib/youtube-match.ts

## Communities (49 total, 9 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.1
Nodes (31): isStatus(), lookup(), prune(), record(), Status, toLookup(), TTL_MS, bestMatch() (+23 more)

### Community 1 - "Community 1"
Cohesion: 0.1
Nodes (42): Ctx, POST(), Home(), Ctx, POST(), POST(), Ctx, DELETE() (+34 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (46): clearSessionCookie(), getSecret(), isSession(), readSessionCookie(), setSessionCookie(), signSession(), verifySessionToken(), POST() (+38 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (27): cache, evictAudioCache(), getPlaybackProviders(), resetPlaybackProvidersForTests(), resolveAudio(), PlaybackProvider, PlaybackStream, ProviderName (+19 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (57): appUrl(), GET(), GET(), importAutoMatchLimit(), POST(), spotifyErrorResponse(), EmbedTrack, findKey() (+49 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (44): RankablePlaylist, RankableSong, scorePlaylist(), scoreSong(), tier(), tokenCoverage(), Candidate, contentTokens() (+36 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (32): dependencies, better-sqlite3, jose, next, @prisma/adapter-better-sqlite3, @prisma/client, react, react-dom (+24 more)

### Community 7 - "Community 7"
Cohesion: 0.16
Nodes (16): Ctx, EMPTY, PlayerCtx, PlayerProvider(), State, clampIndex(), Identified, nextIndex() (+8 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (26): Already captured / not a separate ticket, API authorization changes, Cache model, code:ts (type LyricsResponse =), code:prisma (model LyricsCache {), code:sh (pnpm exec tsc --noEmit), code:sh (graphify update .), Context (+18 more)

### Community 9 - "Community 9"
Cohesion: 0.18
Nodes (13): AddToPlaylistMenu(), PlaylistOption, Props, Status, PlaylistOption, PlayStatus, Props, ResultRow() (+5 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (52): AppLayout(), ClonePlaylistButton(), Props, Status, UserOption, CreatePlaylistForm(), DeletePlaylistButton(), Props (+44 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (60): canRepairSongMatch(), normalizeSong(), parseAltIds(), serializeAltIds(), chain, fetchVideoDetails(), filterEmbeddableIds(), flushPendingMatches() (+52 more)

### Community 12 - "Community 12"
Cohesion: 0.1
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 13 - "Community 13"
Cohesion: 0.14
Nodes (14): CandidateRow(), formatDuration(), parseMetadata(), PickYoutubeMatchModal(), Props, friendlyOverrideError(), Props, REASON_LABELS (+6 more)

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
Nodes (23): LibrarySearchResults(), Props, useNowPlaying(), Props, RecentSearches(), Props, SearchBar(), LoadState (+15 more)

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
Cohesion: 0.36
Nodes (11): clearHistory(), deleteSearch(), isSearchSurface(), listRecent(), recordSearch(), SEARCH_SURFACES, normalizeQuery(), DELETE() (+3 more)

### Community 47 - "Community 47"
Cohesion: 0.15
Nodes (8): AudioError, AudioStatus, LyricsUiState, PlayerBar(), Props, YouTubeAudioPlayer(), Props, getNextPlayableYoutubeId()

### Community 48 - "Community 48"
Cohesion: 0.4
Nodes (4): DONE, Side Bar: iOS-specific or lower-value for web, TODO, Web/iOS Parity Master List

## Knowledge Gaps
- **310 isolated node(s):** `config`, `name`, `version`, `private`, `packageManager` (+305 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getSession()` connect `Community 1` to `Community 2`, `Community 3`, `Community 4`, `Community 10`, `Community 11`, `Community 45`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `unauthorized()` connect `Community 1` to `Community 3`, `Community 11`, `Community 4`, `Community 45`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `truncateAll()` connect `Community 2` to `Community 0`, `Community 3`, `Community 11`, `Community 45`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **What connects `config`, `name`, `version` to the rest of the system?**
  _310 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._