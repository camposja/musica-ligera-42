/// Feature gate for the one-way iOS import API (`/api/ios/*`).
///
/// Ships dormant. `POST /api/ios/auth` is a new *public* credential endpoint,
/// so the code is deployed and verified before it is reachable: deploy with the
/// flag off, confirm every `/api/ios/*` route 404s, then enable for controlled
/// QA. Flipping it back off is also the only blunt revocation lever we have —
/// it invalidates every issued iOS token at once (see `ios-token.ts`).
///
/// Read through this helper rather than touching `process.env` in each route so
/// tests can flip the flag in exactly one place.
export function isIosImportEnabled(): boolean {
  return process.env.IOS_IMPORT_ENABLED === "true";
}

/// Disabled routes answer **404, not 403**, so a prober cannot tell "the feature
/// exists but is off" from "no such route". Returning 403 would advertise the
/// endpoint's existence to anyone scanning.
export function featureDisabled(): Response {
  return Response.json(
    { error: "Not found" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}
