-- CreateTable
CREATE TABLE "YoutubeSearchCache" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YoutubeSearchCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "YoutubeSearchCache_createdAt_idx" ON "YoutubeSearchCache"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "YoutubeSearchCache_day_normalizedQuery_key" ON "YoutubeSearchCache"("day", "normalizedQuery");
