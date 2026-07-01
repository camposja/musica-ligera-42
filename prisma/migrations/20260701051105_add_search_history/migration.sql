-- CreateTable
CREATE TABLE "SearchHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SearchHistory_userId_surface_createdAt_idx" ON "SearchHistory"("userId", "surface", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SearchHistory_userId_surface_normalizedQuery_key" ON "SearchHistory"("userId", "surface", "normalizedQuery");
