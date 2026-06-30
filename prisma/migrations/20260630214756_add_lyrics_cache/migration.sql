-- CreateTable
CREATE TABLE "LyricsCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cacheKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lyrics" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "LyricsCache_cacheKey_key" ON "LyricsCache"("cacheKey");

-- CreateIndex
CREATE INDEX "LyricsCache_createdAt_idx" ON "LyricsCache"("createdAt");
