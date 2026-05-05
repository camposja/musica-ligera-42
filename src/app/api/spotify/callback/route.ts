import { getSession } from "@/lib/auth";
import {
  clearOauthStateCookie,
  exchangeCodeForToken,
  readOauthStateCookie,
  tryFetchSpotifyUserId,
  upsertConnection,
  verifyOauthStateJwt,
} from "@/lib/spotify-oauth";

function appUrl(path: string, request: Request): string {
  const url = new URL(path, request.url);
  return url.toString();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // User clicked Cancel on Spotify's consent screen
  if (error === "access_denied") {
    await clearOauthStateCookie();
    return Response.redirect(appUrl("/dashboard?spotify=forbidden", request), 302);
  }

  // Authorization check first — even with valid params, only OWNER may connect
  const session = await getSession();
  if (!session || session.role !== "OWNER") {
    await clearOauthStateCookie();
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!code || !state) {
    await clearOauthStateCookie();
    return Response.json({ error: "Missing code or state" }, { status: 400 });
  }

  const cookieJwt = await readOauthStateCookie();
  if (!cookieJwt) {
    return Response.json(
      { error: "Missing OAuth state cookie" },
      { status: 400 },
    );
  }
  const stateOk = await verifyOauthStateJwt(cookieJwt, state);
  if (!stateOk) {
    await clearOauthStateCookie();
    return Response.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  // State validated — clear the cookie regardless of token-exchange outcome below
  await clearOauthStateCookie();

  try {
    const tokens = await exchangeCodeForToken(code);
    const spotifyUserId = await tryFetchSpotifyUserId(tokens.access_token);
    await upsertConnection(tokens, spotifyUserId);
    return Response.redirect(
      appUrl("/dashboard?spotify=connected", request),
      302,
    );
  } catch (err) {
    console.error("[spotify-oauth] callback failure", err);
    return Response.redirect(appUrl("/dashboard?spotify=error", request), 302);
  }
}
