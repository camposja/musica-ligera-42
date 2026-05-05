export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfter?: number,
    public readonly code?: string,
    public readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const text = await res.text();
  let body: unknown = {};
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
  }
  if (!res.ok) {
    const ra = res.headers.get("retry-after");
    const b = body as { error?: string; code?: string };
    const errMsg = b.error ?? res.statusText;
    throw new ApiError(
      res.status,
      errMsg,
      ra ? Number(ra) : undefined,
      typeof b.code === "string" ? b.code : undefined,
      body && typeof body === "object" ? (body as Record<string, unknown>) : undefined,
    );
  }
  return body as T;
}
