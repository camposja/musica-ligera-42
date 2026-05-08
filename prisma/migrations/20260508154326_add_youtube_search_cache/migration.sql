-- CreateTable
CREATE TABLE "YoutubeSearchCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "day" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "YoutubeSearchCache_createdAt_idx" ON "YoutubeSearchCache"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "YoutubeSearchCache_day_normalizedQuery_key" ON "YoutubeSearchCache"("day", "normalizedQuery");
