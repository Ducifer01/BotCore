-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VipChannel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "membershipId" INTEGER NOT NULL,
    "channelId" TEXT,
    "name" TEXT,
    "userLimit" INTEGER,
    "categoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VipChannel_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "VipMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VipChannel" ("categoryId", "channelId", "createdAt", "id", "membershipId", "name", "updatedAt", "userLimit") SELECT "categoryId", "channelId", "createdAt", "id", "membershipId", "name", "updatedAt", "userLimit" FROM "VipChannel";
DROP TABLE "VipChannel";
ALTER TABLE "new_VipChannel" RENAME TO "VipChannel";
CREATE UNIQUE INDEX "VipChannel_membershipId_key" ON "VipChannel"("membershipId");
CREATE TABLE "new_VipChannelPermission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vipChannelId" INTEGER NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "allowView" BOOLEAN NOT NULL DEFAULT true,
    "allowConnect" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VipChannelPermission_vipChannelId_fkey" FOREIGN KEY ("vipChannelId") REFERENCES "VipChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VipChannelPermission" ("allowConnect", "allowView", "createdAt", "createdById", "id", "targetUserId", "updatedAt", "vipChannelId") SELECT "allowConnect", "allowView", "createdAt", "createdById", "id", "targetUserId", "updatedAt", "vipChannelId" FROM "VipChannelPermission";
DROP TABLE "VipChannelPermission";
ALTER TABLE "new_VipChannelPermission" RENAME TO "VipChannelPermission";
CREATE UNIQUE INDEX "VipChannelPermission_vipChannelId_targetUserId_key" ON "VipChannelPermission"("vipChannelId", "targetUserId");
CREATE TABLE "new_VipConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "bonusRoleId" TEXT,
    "hideEmptyChannels" BOOLEAN NOT NULL DEFAULT true,
    "allowManualTags" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VipConfig_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VipConfig" ("allowManualTags", "bonusRoleId", "createdAt", "globalConfigId", "hideEmptyChannels", "id", "updatedAt") SELECT "allowManualTags", "bonusRoleId", "createdAt", "globalConfigId", "hideEmptyChannels", "id", "updatedAt" FROM "VipConfig";
DROP TABLE "VipConfig";
ALTER TABLE "new_VipConfig" RENAME TO "VipConfig";
CREATE UNIQUE INDEX "VipConfig_globalConfigId_key" ON "VipConfig"("globalConfigId");
CREATE TABLE "new_VipMembership" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vipPlanId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "vipRoleId" TEXT,
    "bonusRoleId" TEXT,
    "tagRoleId" TEXT,
    "channelId" TEXT,
    "channelParentId" TEXT,
    "lastSetById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VipMembership_vipPlanId_fkey" FOREIGN KEY ("vipPlanId") REFERENCES "VipPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VipMembership" ("active", "bonusRoleId", "channelId", "channelParentId", "createdAt", "expiresAt", "guildId", "id", "lastSetById", "startedAt", "tagRoleId", "updatedAt", "userId", "vipPlanId", "vipRoleId") SELECT "active", "bonusRoleId", "channelId", "channelParentId", "createdAt", "expiresAt", "guildId", "id", "lastSetById", "startedAt", "tagRoleId", "updatedAt", "userId", "vipPlanId", "vipRoleId" FROM "VipMembership";
DROP TABLE "VipMembership";
ALTER TABLE "new_VipMembership" RENAME TO "VipMembership";
CREATE UNIQUE INDEX "VipMembership_userId_key" ON "VipMembership"("userId");
CREATE TABLE "new_VipPlan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vipConfigId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT,
    "durationDays" INTEGER,
    "vipRoleId" TEXT,
    "tagSeparatorRoleId" TEXT,
    "callCategoryId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "isDraft" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VipPlan_vipConfigId_fkey" FOREIGN KEY ("vipConfigId") REFERENCES "VipConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VipPlan" ("callCategoryId", "createdAt", "createdById", "durationDays", "guildId", "id", "isDraft", "name", "tagSeparatorRoleId", "updatedAt", "updatedById", "vipConfigId", "vipRoleId") SELECT "callCategoryId", "createdAt", "createdById", "durationDays", "guildId", "id", "isDraft", "name", "tagSeparatorRoleId", "updatedAt", "updatedById", "vipConfigId", "vipRoleId" FROM "VipPlan";
DROP TABLE "VipPlan";
ALTER TABLE "new_VipPlan" RENAME TO "VipPlan";
CREATE TABLE "new_VipTag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "membershipId" INTEGER NOT NULL,
    "roleId" TEXT,
    "name" TEXT,
    "color" TEXT,
    "emoji" TEXT,
    "iconHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VipTag_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "VipMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VipTag" ("color", "createdAt", "emoji", "iconHash", "id", "membershipId", "name", "roleId", "updatedAt") SELECT "color", "createdAt", "emoji", "iconHash", "id", "membershipId", "name", "roleId", "updatedAt" FROM "VipTag";
DROP TABLE "VipTag";
ALTER TABLE "new_VipTag" RENAME TO "VipTag";
CREATE UNIQUE INDEX "VipTag_membershipId_key" ON "VipTag"("membershipId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
