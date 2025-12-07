-- CreateTable
CREATE TABLE "VipConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "bonusRoleId" TEXT,
    "hideEmptyChannels" BOOLEAN NOT NULL DEFAULT true,
    "allowManualTags" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VipConfig_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VipPlan" (
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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VipPlan_vipConfigId_fkey" FOREIGN KEY ("vipConfigId") REFERENCES "VipConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VipMembership" (
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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VipMembership_vipPlanId_fkey" FOREIGN KEY ("vipPlanId") REFERENCES "VipPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VipTag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "membershipId" INTEGER NOT NULL,
    "roleId" TEXT,
    "name" TEXT,
    "color" TEXT,
    "emoji" TEXT,
    "iconHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VipTag_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "VipMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VipChannel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "membershipId" INTEGER NOT NULL,
    "channelId" TEXT,
    "name" TEXT,
    "userLimit" INTEGER,
    "categoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VipChannel_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "VipMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VipTagShare" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vipTagId" INTEGER NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VipTagShare_vipTagId_fkey" FOREIGN KEY ("vipTagId") REFERENCES "VipTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VipChannelPermission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vipChannelId" INTEGER NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "allowView" BOOLEAN NOT NULL DEFAULT true,
    "allowConnect" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VipChannelPermission_vipChannelId_fkey" FOREIGN KEY ("vipChannelId") REFERENCES "VipChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VipSetPermission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vipConfigId" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VipSetPermission_vipConfigId_fkey" FOREIGN KEY ("vipConfigId") REFERENCES "VipConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VipMembershipLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "membershipId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "amountDays" INTEGER,
    "actorId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VipMembershipLog_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "VipMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "VipConfig_globalConfigId_key" ON "VipConfig"("globalConfigId");

-- CreateIndex
CREATE INDEX "VipPlan_vipConfigId_idx" ON "VipPlan"("vipConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "VipMembership_userId_key" ON "VipMembership"("userId");

-- CreateIndex
CREATE INDEX "VipMembership_vipPlanId_idx" ON "VipMembership"("vipPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "VipTag_membershipId_key" ON "VipTag"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "VipChannel_membershipId_key" ON "VipChannel"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "VipTagShare_vipTagId_targetUserId_key" ON "VipTagShare"("vipTagId", "targetUserId");

-- CreateIndex
CREATE UNIQUE INDEX "VipChannelPermission_vipChannelId_targetUserId_key" ON "VipChannelPermission"("vipChannelId", "targetUserId");

-- CreateIndex
CREATE UNIQUE INDEX "VipSetPermission_vipConfigId_roleId_key" ON "VipSetPermission"("vipConfigId", "roleId");
