-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "accessCode" TEXT NOT NULL,
    "spotifyUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Song" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "album" TEXT,
    "spotifyId" TEXT,
    "youtubeId" TEXT,
    "youtubeAltIdsJson" TEXT NOT NULL DEFAULT '[]',
    "youtubeMatchType" TEXT,
    "youtubeMatchReason" TEXT,
    "youtubeMatchTitle" TEXT,
    "youtubeMatchChannel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "clonedFromId" TEXT,
    "importedAt" DATETIME,
    "sourceLabel" TEXT,
    CONSTRAINT "Playlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaylistSong" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playlistId" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaylistSong_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistSong_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpotifyConnection" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "scope" TEXT NOT NULL,
    "spotifyUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_name_key" ON "User"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Song_spotifyId_key" ON "Song"("spotifyId");

-- CreateIndex
CREATE INDEX "Playlist_userId_idx" ON "Playlist"("userId");

-- CreateIndex
CREATE INDEX "Playlist_clonedFromId_idx" ON "Playlist"("clonedFromId");

-- CreateIndex
CREATE INDEX "PlaylistSong_playlistId_idx" ON "PlaylistSong"("playlistId");

-- CreateIndex
CREATE INDEX "PlaylistSong_songId_idx" ON "PlaylistSong"("songId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistSong_playlistId_songId_key" ON "PlaylistSong"("playlistId", "songId");
