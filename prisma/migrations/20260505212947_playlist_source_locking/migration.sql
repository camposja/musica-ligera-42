-- CreateEnum
CREATE TYPE "PlaylistSource" AS ENUM ('MANUAL', 'SPOTIFY_IMPORT', 'CLONE');

-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN     "clonedFromId" TEXT,
ADD COLUMN     "importedAt" TIMESTAMP(3),
ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" "PlaylistSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "sourceLabel" TEXT;

-- CreateIndex
CREATE INDEX "Playlist_clonedFromId_idx" ON "Playlist"("clonedFromId");
