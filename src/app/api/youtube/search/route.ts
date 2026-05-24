import { getSession, unauthorized } from "@/lib/auth";
import { isQuotaExhaustionReason, YoutubeError } from "@/lib/youtube";
import { searchYoutube } from "@/lib/youtube-search";
import {
  getQuotaStatus,
  markQuotaExhausted,
} from "@/lib/youtube-quota";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (!q || q.trim().length === 0) {
    return Response.json({ error: "q required" }, { status: 400 });
  }

  // `searchYoutube` owns the cache lookup + quota gate. Cache hits skip the
  // gate entirely (no charge). Cache misses run the standard check → consume
  // → fetch flow and throw `youtube_quota_safeguard` if the safety cap would
  // be exceeded.
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
      // Differentiate real quota walls from configuration / auth problems.
      // Only quotaExceeded / dailyLimitExceeded should lock out the rest of
      // the day; keyInvalid, accessNotConfigured, referrerNotAllowed, etc.
      // are operator-fix issues that don't get better by waiting until
      // tomorrow, so they shouldn't burn the safeguard.
      if (isQuotaExhaustionReason(err.reason)) {
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
      return Response.json(
        {
          code: "youtube_config_error",
          error: err.message,
          reason: err.reason ?? null,
        },
        { status: 502 },
      );
    }
    if (err.httpStatus === 429) {
      // Distinguish the app-level safeguard (we threw because the daily
      // safety cap would be exceeded) from a real upstream rate-limit
      // (Google sent us a 429). Different status, different code.
      if (err.message === "youtube_quota_safeguard") {
        const quota = await getQuotaStatus();
        return Response.json(
          {
            code: "youtube_quota_safeguard",
            error: "Daily YouTube quota safeguard reached.",
            remainingSearches: quota.remainingSearches,
            resetsAt: quota.resetsAt,
          },
          { status: 429 },
        );
      }
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
