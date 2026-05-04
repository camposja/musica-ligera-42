"use client";

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

type Props = {
  videoId: string | null | undefined;
  width?: number | string;
  height?: number | string;
  title?: string;
};

export default function YouTubePlayer({
  videoId,
  width = "100%",
  height = 360,
  title = "YouTube player",
}: Props) {
  if (!videoId || !VIDEO_ID_RE.test(videoId)) return null;
  return (
    <iframe
      width={width}
      height={height}
      src={`https://www.youtube.com/embed/${videoId}`}
      title={title}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
    />
  );
}

export { VIDEO_ID_RE };
