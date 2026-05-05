"use client";

type Props = {
  videoId: string;
  onError?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
};

export function YouTubeAudioPlayer({
  videoId,
  onError,
  onEnded,
  onTimeUpdate,
}: Props) {
  return (
    <audio
      key={videoId}
      controls
      autoPlay
      preload="metadata"
      src={`/api/youtube/audio/${videoId}`}
      onError={onError}
      onEnded={onEnded}
      onTimeUpdate={(e) => {
        if (!onTimeUpdate) return;
        const el = e.currentTarget;
        const t = el.currentTime;
        const d = el.duration;
        if (Number.isFinite(t) && Number.isFinite(d) && d > 0) {
          onTimeUpdate(t, d);
        }
      }}
      className="w-full"
    />
  );
}
