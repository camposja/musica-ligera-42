-- CreateTable
CREATE TABLE "ApiQuotaUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "service" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "unitsUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ApiQuotaUsage_service_day_idx" ON "ApiQuotaUsage"("service", "day");

-- CreateIndex
CREATE UNIQUE INDEX "ApiQuotaUsage_service_day_key" ON "ApiQuotaUsage"("service", "day");
