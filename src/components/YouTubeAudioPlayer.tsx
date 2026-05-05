"use client";

type Props = {
  videoId: string;
  onError?: () => void;
};

export function YouTubeAudioPlayer({ videoId, onError }: Props) {
  return (
    <audio
      key={videoId}
      controls
      autoPlay
      preload="metadata"
      src={`/api/youtube/audio/${videoId}`}
      onError={onError}
      className="w-full"
    />
  );
}
