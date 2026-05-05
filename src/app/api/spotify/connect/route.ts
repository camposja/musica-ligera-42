import { forbidden, getSession, unauthorized } from "@/lib/auth";
import {
  buildAuthorizeUrl,
  setOauthStateCookie,
  signOauthState,
} from "@/lib/spotify-oauth";

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== "OWNER") return forbidden();

  const { state, jwt } = await signOauthState();
  await setOauthStateCookie(jwt);
  return Response.redirect(buildAuthorizeUrl(state), 302);
}
