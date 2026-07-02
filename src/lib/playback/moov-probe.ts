import {
  applyPatchToChunk,
  durationFieldOffsets,
  moovEndIfTruncated,
} from "@/lib/playback/moov-duration-patcher";
import type { MoovPatchState, PlaybackStream } from "@/lib/playback/types";

// Probes a resolved stream's head for the fragmented-MP4 duration fields and
// caches the decision on the PlaybackStream entry (once per 45-min cache TTL).
// Fail-safe by design: any probe/parse failure → {state:"none"} → the stream
// is served byte-for-byte unchanged. Playback must never block on the patch.

const HEAD_PROBE_BYTES = 65536;
// Give up rather than re-fetch an absurdly large declared moov.
const MOOV_REFETCH_CAP = 10 * 1024 * 1024;

// MP4 audio content types we patch (normalized, parameters stripped).
// Anything else — webm/opus especially — is never probed or patched.
const MP4_AUDIO_TYPES = new Set(["audio/mp4", "audio/x-m4a", "audio/m4a"]);

export function isPatchDisabled(): boolean {
  return process.env.DISABLE_MOOV_DURATION_PATCH === "1";
}

function isMp4Audio(contentType: string): boolean {
  const base = contentType.split(";")[0].trim().toLowerCase();
  return MP4_AUDIO_TYPES.has(base);
}

async function fetchHead(url: string, endInclusive: number): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { range: `bytes=0-${endInclusive}` },
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`head probe returned ${res.status}`);
  }
  if (!res.body) throw new Error("head probe had no body");

  // A 206 body is already just the range; a 200 body is the whole file — read
  // only what we need and cancel the rest.
  const wanted = endInclusive + 1;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (received < wanted) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const head = new Uint8Array(Math.min(received, wanted));
  let pos = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, head.length - pos);
    if (take <= 0) break;
    head.set(take === chunk.byteLength ? chunk : chunk.subarray(0, take), pos);
    pos += take;
  }
  return head;
}

async function probe(videoId: string, stream: PlaybackStream): Promise<MoovPatchState> {
  let head = await fetchHead(stream.url, HEAD_PROBE_BYTES - 1);
  // If the moov's declared size runs past the probe, re-fetch exactly enough
  // and re-parse — a partial moov must never drive a partial patch.
  const moovEnd = moovEndIfTruncated(head);
  if (moovEnd !== null) {
    if (moovEnd > MOOV_REFETCH_CAP) {
      console.warn("[playback] moov patch skipped: declared moov too large", {
        videoId,
        moovEnd,
      });
      return { state: "none" };
    }
    head = await fetchHead(stream.url, moovEnd - 1);
  }
  const offsets = durationFieldOffsets(head);
  if (offsets.length === 0) {
    console.log("[playback] moov patch skipped: not fragmented (no mvex) or parse failed", {
      videoId,
    });
    return { state: "none" };
  }
  console.log("[playback] moov patch: zeroing duration fields", {
    videoId,
    offsets,
  });
  return { state: "offsets", offsets };
}

// Decide (once per cached stream) whether/where to patch this stream's bytes.
// Mutates the cached PlaybackStream entry so the decision persists for its TTL;
// concurrent requests share one in-flight probe.
export async function ensureMoovPatch(
  videoId: string,
  stream: PlaybackStream,
): Promise<MoovPatchState> {
  if (stream.moovPatch) return stream.moovPatch;
  if (stream.moovPatchPromise) return stream.moovPatchPromise;

  if (isPatchDisabled()) {
    console.log("[playback] moov patch skipped: disabled by env", { videoId });
    stream.moovPatch = { state: "none" };
    return stream.moovPatch;
  }
  if (!isMp4Audio(stream.contentType)) {
    console.log("[playback] moov patch skipped: non-mp4 content-type", {
      videoId,
      contentType: stream.contentType,
    });
    stream.moovPatch = { state: "none" };
    return stream.moovPatch;
  }

  stream.moovPatchPromise = probe(videoId, stream)
    .catch((err): MoovPatchState => {
      console.warn("[playback] moov probe failed — serving unpatched", {
        videoId,
        err,
      });
      return { state: "none" };
    })
    .then((result) => {
      stream.moovPatch = result;
      stream.moovPatchPromise = undefined;
      return result;
    });
  return stream.moovPatchPromise;
}

// Wraps a served body so the duration fields overlapping this response's byte
// range are zeroed in flight. `servedStart` is the absolute file offset of the
// response's first byte (0 for a 200, the content-range start for a 206).
// Size-preserving: byte count is untouched, so content-length/range stay valid.
export function createMoovPatchTransform(
  offsets: number[],
  servedStart: number,
): TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>> {
  let abs = servedStart;
  const patchEnd = Math.max(...offsets) + 4;
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(abs < patchEnd ? applyPatchToChunk(chunk, abs, offsets) : chunk);
      abs += chunk.byteLength;
    },
  });
}
