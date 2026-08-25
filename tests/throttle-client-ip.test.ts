import { describe, expect, it } from "vitest";
import { clientIpFrom } from "@/lib/throttle";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/auth/login", { method: "POST", headers });
}

describe("clientIpFrom", () => {
  it("prefers Fly-Client-IP, which the Fly proxy sets and a client cannot forge", () => {
    expect(
      clientIpFrom(req({ "fly-client-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" })),
    ).toBe("203.0.113.9");
  });

  it("NEVER takes the first X-Forwarded-For entry — that value is attacker-controlled", () => {
    // A client that sends its own X-Forwarded-For has its value left in FRONT
    // when a proxy appends. Keying on the first entry would let one host mint a
    // fresh throttle bucket per request by varying a single header.
    const spoofed = clientIpFrom(
      req({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 203.0.113.9" }),
    );
    expect(spoofed).not.toBe("9.9.9.9");
    expect(spoofed).toBe("203.0.113.9");
  });

  it("two requests with different spoofed prefixes still share one throttle key", () => {
    const a = clientIpFrom(req({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }));
    const b = clientIpFrom(req({ "x-forwarded-for": "2.2.2.2, 203.0.113.9" }));
    expect(a).toBe(b);
  });

  it("falls back to null rather than keying on an untrustworthy value", () => {
    expect(clientIpFrom(req({}))).toBeNull();
    expect(clientIpFrom(req({ "x-forwarded-for": "" }))).toBeNull();
  });
});
