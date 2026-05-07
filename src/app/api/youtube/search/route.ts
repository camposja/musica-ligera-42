import { getSession, unauthorized } from "@/lib/auth";
import { YoutubeError } from "@/lib/youtube";
import { searchYoutube } from "@/lib/youtube-search";
import {
  checkQuota,
  consumeQuota,
  getQuotaStatus,
  markQuotaExhausted,
  SEARCH_UNIT_COST,
} from "@/lib/youtube-quota";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (!q || q.trim().length === 0) {
    return Response.json({ error: "q required" }, { status: 400 });
  }

  // Daily quota safeguard. Same gate as matchSongById/rematch-missing — all
  // YouTube Data API consumers share one ledger.
  const check = await checkQuota(SEARCH_UNIT_COST);
  if (!check.ok) {
    return Response.json(
      {
        code: "youtube_quota_safeguard",
        error: "Daily YouTube quota safeguard reached.",
        remainingSearches: check.remainingSearches,
        resetsAt: check.resetsAt,
      },
      { status: 429 },
    );
  }
  // Charge BEFORE the call (Google bills per attempt regardless of outcome).
  await consumeQuota(SEARCH_UNIT_COST);

  try {
    const results = await searchYoutube(q.trim());
    const quota = await getQuotaStatus();
    return Response.json({ results, quota });
  } catch (err) {
    return await youtubeErrorResponse(err);
  }
}

async function youtubeErrorResponse(err: unknown): Promise<Response> {
  if (err instanceof YoutubeError) {
    if (err.httpStatus === 403) {
      // Real upstream quota — defensive lockout for the rest of today.
      await markQuotaExhausted();
      const quota = await getQuotaStatus();
      return Response.json(
        {
          code: "youtube_quota_safeguard",
          error: "YouTube upstream quota exceeded.",
          remainingSearches: quota.remainingSearches,
          resetsAt: quota.resetsAt,
        },
        { status: 429 },
      );
    }
    if (err.httpStatus === 429) {
      const headers = new Headers({ "content-type": "application/json" });
      if (err.retryAfterSeconds !== undefined) {
        headers.set("retry-after", String(err.retryAfterSeconds));
      }
      return new Response(
        JSON.stringify({
          error: "YouTube rate limit",
          retryAfterSeconds: err.retryAfterSeconds ?? null,
        }),
        { status: 503, headers },
      );
    }
    if (err.httpStatus === 0) {
      return Response.json({ error: err.message }, { status: 502 });
    }
    return Response.json(
      { error: "YouTube upstream error", upstreamStatus: err.httpStatus },
      { status: 502 },
    );
  }
  throw err;
}
