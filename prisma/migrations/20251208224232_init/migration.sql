-- CreateTable
CREATE TABLE "GlobalConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "verifyPanelChannelId" TEXT,
    "mainRoleId" TEXT,
    "verifiedRoleId" TEXT,
    "instaBoysChannelId" TEXT,
    "instaGirlsChannelId" TEXT,
    "photosChannelId" TEXT,
    "photosMaleChannelId" TEXT,
    "photosFemaleChannelId" TEXT,
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

-- CreateTable
CREATE TABLE "TicketPingRoleGlobal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "TicketPingRoleGlobal_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupportRoleGlobal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "SupportRoleGlobal_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutoModConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "punishmentType" TEXT NOT NULL DEFAULT 'DELETE',
    "punishmentDurationSeconds" INTEGER,
    "reason" TEXT NOT NULL DEFAULT 'Palavra Proibida',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutoModConfig_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutoModBlockedWord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "autoModConfigId" INTEGER NOT NULL,
    "word" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutoModBlockedWord_autoModConfigId_fkey" FOREIGN KEY ("autoModConfigId") REFERENCES "AutoModConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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

-- CreateTable
CREATE TABLE "MutePermission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "commandType" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "MutePermission_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "threadId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "openerId" TEXT NOT NULL,
    "openerTag" TEXT,
    "closedBy" TEXT,
    "closedAt" DATETIME,
    "transcriptUrl" TEXT,
    "logMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VerifiedUserGlobal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedBy" TEXT,
    "sex" TEXT
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

-- CreateTable
CREATE TABLE "Guild" (
    "guild_id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "posseUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    "commandChannelId" TEXT,
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
    "commandChannelId" TEXT,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChatMute_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommandConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CommandConfig_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("guild_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AllowedUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "commandId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "AllowedUser_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "CommandConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AllowedRole" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "commandId" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "AllowedRole_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "CommandConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("guild_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GuildConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "verifyPanelChannelId" TEXT,
    "mainRoleId" TEXT,
    "verifiedRoleId" TEXT,
    "instaBoysChannelId" TEXT,
    "instaGirlsChannelId" TEXT,
    CONSTRAINT "GuildConfig_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("guild_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TicketPingRole" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildConfigId" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "TicketPingRole_guildConfigId_fkey" FOREIGN KEY ("guildConfigId") REFERENCES "GuildConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerifiedUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedBy" TEXT,
    CONSTRAINT "VerifiedUser_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("guild_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstaPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "mediaUrl" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InstaPost_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("guild_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstaLike" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstaLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "InstaPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstaComment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstaComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "InstaPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstaWinner" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "winnerUserId" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL,
    "winnerMessageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstaWinner_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("guild_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VipConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "bonusRoleId" TEXT,
    "hideEmptyChannels" BOOLEAN NOT NULL DEFAULT true,
    "allowManualTags" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
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
    "updatedAt" DATETIME NOT NULL,
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
    "updatedAt" DATETIME NOT NULL,
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
    "iconData" BLOB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
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
    "updatedAt" DATETIME NOT NULL,
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
    "updatedAt" DATETIME NOT NULL,
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
CREATE UNIQUE INDEX "TicketPingRoleGlobal_globalConfigId_roleId_key" ON "TicketPingRoleGlobal"("globalConfigId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportRoleGlobal_globalConfigId_roleId_key" ON "SupportRoleGlobal"("globalConfigId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoModConfig_globalConfigId_key" ON "AutoModConfig"("globalConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoModBlockedWord_autoModConfigId_word_key" ON "AutoModBlockedWord"("autoModConfigId", "word");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationConfig_globalConfigId_key" ON "ModerationConfig"("globalConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationPermission_moderationConfigId_commandType_roleId_key" ON "ModerationPermission"("moderationConfigId", "commandType", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "MutePermission_globalConfigId_commandType_roleId_key" ON "MutePermission"("globalConfigId", "commandType", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_threadId_key" ON "SupportTicket"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedUserGlobal_userId_key" ON "VerifiedUserGlobal"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InstaLikeGlobal_postId_userId_key" ON "InstaLikeGlobal"("postId", "userId");

-- CreateIndex
CREATE INDEX "VoiceMute_guildId_userId_idx" ON "VoiceMute"("guildId", "userId");

-- CreateIndex
CREATE INDEX "ChatMute_guildId_userId_idx" ON "ChatMute"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommandConfig_guildId_name_key" ON "CommandConfig"("guildId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AllowedUser_commandId_userId_key" ON "AllowedUser"("commandId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AllowedRole_commandId_roleId_key" ON "AllowedRole"("commandId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketPingRole_guildConfigId_roleId_key" ON "TicketPingRole"("guildConfigId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedUser_guildId_userId_key" ON "VerifiedUser"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "InstaLike_postId_userId_key" ON "InstaLike"("postId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "VipConfig_globalConfigId_key" ON "VipConfig"("globalConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "VipMembership_userId_key" ON "VipMembership"("userId");

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
