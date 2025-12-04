-- CreateTable
CREATE TABLE "GlobalConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "verifyPanelChannelId" TEXT,
    "mainRoleId" TEXT,
    "verifiedRoleId" TEXT,
    "instaBoysChannelId" TEXT,
    "instaGirlsChannelId" TEXT,
    "photosChannelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TicketPingRoleGlobal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "TicketPingRoleGlobal_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerifiedUserGlobal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedBy" TEXT
);

-- CreateTable
CREATE TABLE "InstaPostGlobal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "mediaUrl" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "InstaLikeGlobal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstaLikeGlobal_postId_fkey" FOREIGN KEY ("postId") REFERENCES "InstaPostGlobal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstaCommentGlobal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstaCommentGlobal_postId_fkey" FOREIGN KEY ("postId") REFERENCES "InstaPostGlobal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstaWinnerGlobal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "channelId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "winnerUserId" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL,
    "winnerMessageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketPingRoleGlobal_globalConfigId_roleId_key" ON "TicketPingRoleGlobal"("globalConfigId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedUserGlobal_userId_key" ON "VerifiedUserGlobal"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InstaLikeGlobal_postId_userId_key" ON "InstaLikeGlobal"("postId", "userId");
