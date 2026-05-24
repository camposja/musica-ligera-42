import { forbidden, getSession, unauthorized } from "@/lib/auth";
import { getAppSettings, updateAppSettings } from "@/lib/app-settings";

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== "OWNER") return forbidden();

  const settings = await getAppSettings();
  return Response.json(settings);
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== "OWNER") return forbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const patch: Partial<{ allowChildSpotifyLogin: boolean }> = {};
  if ("allowChildSpotifyLogin" in b) {
    if (typeof b.allowChildSpotifyLogin !== "boolean") {
      return Response.json(
        { error: "allowChildSpotifyLogin must be a boolean" },
        { status: 400 },
      );
    }
    patch.allowChildSpotifyLogin = b.allowChildSpotifyLogin;
  }

  const settings = await updateAppSettings(patch);
  return Response.json(settings);
}
