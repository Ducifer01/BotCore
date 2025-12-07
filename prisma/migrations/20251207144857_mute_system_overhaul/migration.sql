/*
  Warnings:

  - You are about to drop the column `muteBotId` on the `GlobalConfig` table. All the data in the column will be lost.
  - You are about to drop the column `muteRoleId` on the `GlobalConfig` table. All the data in the column will be lost.
  - You are about to drop the column `muteUnlockChannelId` on the `GlobalConfig` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "MutePermission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "commandType" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "MutePermission_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VoiceMute" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT,
    "reason" TEXT,
    "durationSeconds" INTEGER,
    "expiresAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VoiceMute_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMute" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT,
    "reason" TEXT,
    "durationSeconds" INTEGER,
    "expiresAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChatMute_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GlobalConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "verifyPanelChannelId" TEXT,
    "mainRoleId" TEXT,
    "verifiedRoleId" TEXT,
    "instaBoysChannelId" TEXT,
    "instaGirlsChannelId" TEXT,
    "photosChannelId" TEXT,
    "muteVoiceRoleId" TEXT,
    "muteVoiceUnlockChannelId" TEXT,
    "muteVoiceLogChannelId" TEXT,
    "muteChatRoleId" TEXT,
    "muteChatLogChannelId" TEXT,
    "supportPanelChannelId" TEXT,
    "supportLogChannelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_GlobalConfig" (
    "createdAt",
    "id",
    "instaBoysChannelId",
    "instaGirlsChannelId",
    "mainRoleId",
    "photosChannelId",
    "supportLogChannelId",
    "supportPanelChannelId",
    "updatedAt",
    "verifiedRoleId",
    "verifyPanelChannelId",
    "muteVoiceRoleId",
    "muteVoiceUnlockChannelId",
    "muteVoiceLogChannelId",
    "muteChatRoleId",
    "muteChatLogChannelId"
) SELECT
    "createdAt",
    "id",
    "instaBoysChannelId",
    "instaGirlsChannelId",
    "mainRoleId",
    "photosChannelId",
    "supportLogChannelId",
    "supportPanelChannelId",
    "updatedAt",
    "verifiedRoleId",
    "verifyPanelChannelId",
    "muteRoleId",
    "muteUnlockChannelId",
    NULL,
    NULL,
    NULL
FROM "GlobalConfig";
DROP TABLE "GlobalConfig";
ALTER TABLE "new_GlobalConfig" RENAME TO "GlobalConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "MutePermission_globalConfigId_commandType_roleId_key" ON "MutePermission"("globalConfigId", "commandType", "roleId");

-- CreateIndex
CREATE INDEX "VoiceMute_guildId_userId_idx" ON "VoiceMute"("guildId", "userId");

-- CreateIndex
CREATE INDEX "ChatMute_guildId_userId_idx" ON "ChatMute"("guildId", "userId");
