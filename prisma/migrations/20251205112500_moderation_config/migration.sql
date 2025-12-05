-- CreateTable
CREATE TABLE "ModerationConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "banEnabled" BOOLEAN NOT NULL DEFAULT false,
    "banLogChannelId" TEXT,
    "banDmEnabled" BOOLEAN NOT NULL DEFAULT false,
    "banDmMessage" TEXT,
    "banDmContactId" TEXT,
    "castigoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "castigoLogChannelId" TEXT,
    "castigoDmEnabled" BOOLEAN NOT NULL DEFAULT false,
    "castigoDmMessage" TEXT,
    "castigoDmContactId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ModerationConfig_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModerationPermission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "moderationConfigId" INTEGER NOT NULL,
    "commandType" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "ModerationPermission_moderationConfigId_fkey" FOREIGN KEY ("moderationConfigId") REFERENCES "ModerationConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ModerationConfig_globalConfigId_key" ON "ModerationConfig"("globalConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationPermission_moderationConfigId_commandType_roleId_key" ON "ModerationPermission"("moderationConfigId", "commandType", "roleId");
