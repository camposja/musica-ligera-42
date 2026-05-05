import { getSession } from "@/lib/auth";
import {
  clearOauthStateCookie,
  exchangeCodeForToken,
  readOauthStateCookie,
  tryFetchSpotifyUserId,
  upsertConnection,
  verifyOauthStateJwt,
} from "@/lib/spotify-oauth";

// Always build the post-OAuth landing URL from SPOTIFY_REDIRECT_URI's origin,
// not from request.url — `request.url`'s host can be whatever the browser
// sent (0.0.0.0 from a stale terminal click, a LAN IP, etc.) and we'd
// inherit a broken host into the redirect. SPOTIFY_REDIRECT_URI is
// guaranteed canonical (Spotify itself redirected here using it).
function appUrl(path: string): string {
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  const base = redirectUri
    ? new URL(redirectUri).origin
    : "http://127.0.0.1:3000";
  return new URL(path, base).toString();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // User clicked Cancel on Spotify's consent screen
  if (error === "access_denied") {
    await clearOauthStateCookie();
    return Response.redirect(appUrl("/dashboard?spotify=forbidden"), 302);
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
      appUrl("/dashboard?spotify=connected"),
      302,
    );
  } catch (err) {
    console.error("[spotify-oauth] callback failure", err);
    return Response.redirect(appUrl("/dashboard?spotify=error"), 302);
  }
}
