import { forbidden, getSession, unauthorized } from "@/lib/auth";
import { getAppSettings } from "@/lib/app-settings";
import {
  buildAuthorizeUrl,
  setOauthStateCookie,
  signOauthState,
} from "@/lib/spotify-oauth";

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  if (session.role !== "OWNER") {
    const { allowChildSpotifyLogin } = await getAppSettings();
    if (!allowChildSpotifyLogin) return forbidden();
  }

  const { state, jwt } = await signOauthState();
  await setOauthStateCookie(jwt);
  return Response.redirect(buildAuthorizeUrl(state), 302);
}
