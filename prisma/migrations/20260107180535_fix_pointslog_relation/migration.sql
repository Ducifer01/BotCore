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
    "auditManualMuteLogChannelId" TEXT,
    "inviteTrackingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inviteRankingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inviteRankingChannelId" TEXT,
    "inviteRankingGuildId" TEXT,
    "inviteRankingMessageId" TEXT,
    "inviteRankingLastRefresh" DATETIME,
    "inviteLogChannelId" TEXT,
    "inviteAccountAgeFilterEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inviteAccountAgeMinDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PointsConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'GLOBAL',
    "pontosChat" BIGINT NOT NULL DEFAULT 2,
    "pontosCall" BIGINT NOT NULL DEFAULT 5,
    "pontosConvites" BIGINT NOT NULL DEFAULT 50,
    "cooldownChatMinutes" INTEGER NOT NULL DEFAULT 2,
    "limitDailyChat" BIGINT,
    "tempoCallMinutes" INTEGER NOT NULL DEFAULT 5,
    "tempoServerHours" INTEGER NOT NULL DEFAULT 24,
    "idadeContaDias" INTEGER NOT NULL DEFAULT 7,
    "minUserCall" INTEGER NOT NULL DEFAULT 0,
    "diasConvite" INTEGER NOT NULL DEFAULT 7,
    "qtdCaracteresMin" INTEGER NOT NULL DEFAULT 20,
    "logsAdminChannelId" TEXT,
    "logsUsuariosChannelId" TEXT,
    "leaderboardRefreshMinutes" INTEGER NOT NULL DEFAULT 10,
    "leaderboardLastRefresh" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "inviteAntiReentryEnabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "PointsConfig_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsBioCheckerConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pointsConfigId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "keyword" TEXT,
    "selfToken" TEXT,
    "strictMode" BOOLEAN NOT NULL DEFAULT true,
    "cacheTtlMs" INTEGER NOT NULL DEFAULT 600000,
    "lastSuccessAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PointsBioCheckerConfig_pointsConfigId_fkey" FOREIGN KEY ("pointsConfigId") REFERENCES "PointsConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsParticipantRole" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pointsConfigId" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "PointsParticipantRole_pointsConfigId_fkey" FOREIGN KEY ("pointsConfigId") REFERENCES "PointsConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsIgnoredRole" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pointsConfigId" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "PointsIgnoredRole_pointsConfigId_fkey" FOREIGN KEY ("pointsConfigId") REFERENCES "PointsConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsIgnoredUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pointsConfigId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "PointsIgnoredUser_pointsConfigId_fkey" FOREIGN KEY ("pointsConfigId") REFERENCES "PointsConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsChatChannel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pointsConfigId" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    CONSTRAINT "PointsChatChannel_pointsConfigId_fkey" FOREIGN KEY ("pointsConfigId") REFERENCES "PointsConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsVoiceChannel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pointsConfigId" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    CONSTRAINT "PointsVoiceChannel_pointsConfigId_fkey" FOREIGN KEY ("pointsConfigId") REFERENCES "PointsConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsVoiceCategory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pointsConfigId" INTEGER NOT NULL,
    "categoryId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    CONSTRAINT "PointsVoiceCategory_pointsConfigId_fkey" FOREIGN KEY ("pointsConfigId") REFERENCES "PointsConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsBalance" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "points" BIGINT NOT NULL DEFAULT 0,
    "frozenUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PointsBalance_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsChatActivity" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastMessageAt" DATETIME,
    "lastMessageHash" TEXT,
    "dailyPoints" BIGINT NOT NULL DEFAULT 0,
    "dailyDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PointsChatActivity_globalConfigId_guildId_userId_fkey" FOREIGN KEY ("globalConfigId", "guildId", "userId") REFERENCES "PointsBalance" ("globalConfigId", "guildId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsVoiceSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT,
    "startedAt" DATETIME,
    "accumulatedSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PointsVoiceSession_globalConfigId_guildId_userId_fkey" FOREIGN KEY ("globalConfigId", "guildId", "userId") REFERENCES "PointsBalance" ("globalConfigId", "guildId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "amount" BIGINT NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointsTransaction_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PointsTransaction_globalConfigId_guildId_userId_fkey" FOREIGN KEY ("globalConfigId", "guildId", "userId") REFERENCES "PointsBalance" ("globalConfigId", "guildId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsPunishment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT,
    "reason" TEXT,
    "expiresAt" DATETIME,
    "liftedAt" DATETIME,
    "commandChannelId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PointsPunishment_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PointsPunishment_globalConfigId_guildId_userId_fkey" FOREIGN KEY ("globalConfigId", "guildId", "userId") REFERENCES "PointsBalance" ("globalConfigId", "guildId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsInviteLedger" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "invitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    "pointsAwarded" BIGINT NOT NULL DEFAULT 0,
    "revokedAt" DATETIME,
    "revokedReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    CONSTRAINT "PointsInviteLedger_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "change" BIGINT NOT NULL,
    "totalAfter" BIGINT NOT NULL,
    "actorId" TEXT NOT NULL,
    "motivo" TEXT,
    "evidenceUrl" TEXT,
    "referencedLogId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointsLog_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsLeaderboardPanel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "pointsConfigId" INTEGER,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "refreshMinutes" INTEGER NOT NULL DEFAULT 10,
    "lastRefreshAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PointsLeaderboardPanel_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PointsLeaderboardPanel_pointsConfigId_fkey" FOREIGN KEY ("pointsConfigId") REFERENCES "PointsConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE TABLE "AntiSpamConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "messageLimit" INTEGER NOT NULL DEFAULT 5,
    "perSeconds" INTEGER NOT NULL DEFAULT 5,
    "punishmentMode" TEXT NOT NULL DEFAULT 'MUTE',
    "muteDurationSeconds" INTEGER NOT NULL DEFAULT 300,
    "timeoutDurationSeconds" INTEGER NOT NULL DEFAULT 300,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AntiSpamConfig_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AntiSpamIgnoredChannel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "antiSpamConfigId" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    CONSTRAINT "AntiSpamIgnoredChannel_antiSpamConfigId_fkey" FOREIGN KEY ("antiSpamConfigId") REFERENCES "AntiSpamConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AntiSpamBypassRole" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "antiSpamConfigId" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "AntiSpamBypassRole_antiSpamConfigId_fkey" FOREIGN KEY ("antiSpamConfigId") REFERENCES "AntiSpamConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE TABLE "Blacklist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CastigoRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT,
    "reason" TEXT,
    "durationSeconds" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "commandChannelId" TEXT,
    "endedAt" DATETIME,
    "endedReason" TEXT,
    "endedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CastigoRecord_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InviteStat" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviterTag" TEXT,
    "inviteCode" TEXT,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "lastJoinedUserId" TEXT,
    "lastJoinAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InviteStat_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InviteEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inviterId" TEXT,
    "inviterTag" TEXT,
    "inviteCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InviteEvent_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChannelCleanerPanel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "intervalSeconds" INTEGER NOT NULL,
    "filterMessageId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChannelCleanerPanel_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE TABLE "CommandPermissionGlobal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "commandName" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "CommandPermissionGlobal_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "sex" TEXT,
    "photoUrl" TEXT,
    "photoMessageId" TEXT,
    "photoChannelId" TEXT
);

-- CreateTable
CREATE TABLE "SnapshotConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "waitForEmpty" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SnapshotTarget" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "configId" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SnapshotTarget_configId_fkey" FOREIGN KEY ("configId") REFERENCES "SnapshotConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserStatGlobal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "voiceSeconds" INTEGER NOT NULL DEFAULT 0,
    "voiceSessionStartedAt" DATETIME,
    "voiceSessionChannelId" TEXT,
    "lastMessageAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
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

-- CreateIndex
CREATE UNIQUE INDEX "PointsConfig_globalConfigId_key" ON "PointsConfig"("globalConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsBioCheckerConfig_pointsConfigId_key" ON "PointsBioCheckerConfig"("pointsConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsParticipantRole_pointsConfigId_roleId_key" ON "PointsParticipantRole"("pointsConfigId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsIgnoredRole_pointsConfigId_roleId_key" ON "PointsIgnoredRole"("pointsConfigId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsIgnoredUser_pointsConfigId_userId_key" ON "PointsIgnoredUser"("pointsConfigId", "userId");

-- CreateIndex
CREATE INDEX "PointsChatChannel_guildId_idx" ON "PointsChatChannel"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsChatChannel_pointsConfigId_channelId_key" ON "PointsChatChannel"("pointsConfigId", "channelId");

-- CreateIndex
CREATE INDEX "PointsVoiceChannel_guildId_idx" ON "PointsVoiceChannel"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsVoiceChannel_pointsConfigId_channelId_key" ON "PointsVoiceChannel"("pointsConfigId", "channelId");

-- CreateIndex
CREATE INDEX "PointsVoiceCategory_guildId_idx" ON "PointsVoiceCategory"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsVoiceCategory_pointsConfigId_categoryId_key" ON "PointsVoiceCategory"("pointsConfigId", "categoryId");

-- CreateIndex
CREATE INDEX "PointsBalance_guildId_userId_idx" ON "PointsBalance"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsBalance_globalConfigId_guildId_userId_key" ON "PointsBalance"("globalConfigId", "guildId", "userId");

-- CreateIndex
CREATE INDEX "PointsChatActivity_guildId_userId_idx" ON "PointsChatActivity"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsChatActivity_globalConfigId_guildId_userId_key" ON "PointsChatActivity"("globalConfigId", "guildId", "userId");

-- CreateIndex
CREATE INDEX "PointsVoiceSession_guildId_userId_idx" ON "PointsVoiceSession"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsVoiceSession_globalConfigId_guildId_userId_key" ON "PointsVoiceSession"("globalConfigId", "guildId", "userId");

-- CreateIndex
CREATE INDEX "PointsTransaction_guildId_userId_createdAt_idx" ON "PointsTransaction"("guildId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "PointsPunishment_guildId_userId_active_idx" ON "PointsPunishment"("guildId", "userId", "active");

-- CreateIndex
CREATE INDEX "PointsPunishment_expiresAt_idx" ON "PointsPunishment"("expiresAt");

-- CreateIndex
CREATE INDEX "PointsInviteLedger_guildId_inviterId_idx" ON "PointsInviteLedger"("guildId", "inviterId");

-- CreateIndex
CREATE INDEX "PointsInviteLedger_status_invitedAt_idx" ON "PointsInviteLedger"("status", "invitedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointsInviteLedger_guildId_inviteeId_key" ON "PointsInviteLedger"("guildId", "inviteeId");

-- CreateIndex
CREATE INDEX "PointsLog_guildId_idx" ON "PointsLog"("guildId");

-- CreateIndex
CREATE INDEX "PointsLog_userId_idx" ON "PointsLog"("userId");

-- CreateIndex
CREATE INDEX "PointsLeaderboardPanel_guildId_isActive_idx" ON "PointsLeaderboardPanel"("guildId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PointsLeaderboardPanel_guildId_channelId_messageId_key" ON "PointsLeaderboardPanel"("guildId", "channelId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketPingRoleGlobal_globalConfigId_roleId_key" ON "TicketPingRoleGlobal"("globalConfigId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportRoleGlobal_globalConfigId_roleId_key" ON "SupportRoleGlobal"("globalConfigId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoModConfig_globalConfigId_key" ON "AutoModConfig"("globalConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoModBlockedWord_autoModConfigId_word_key" ON "AutoModBlockedWord"("autoModConfigId", "word");

-- CreateIndex
CREATE UNIQUE INDEX "AntiSpamConfig_globalConfigId_key" ON "AntiSpamConfig"("globalConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "AntiSpamIgnoredChannel_antiSpamConfigId_channelId_key" ON "AntiSpamIgnoredChannel"("antiSpamConfigId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "AntiSpamBypassRole_antiSpamConfigId_roleId_key" ON "AntiSpamBypassRole"("antiSpamConfigId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationConfig_globalConfigId_key" ON "ModerationConfig"("globalConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationPermission_moderationConfigId_commandType_roleId_key" ON "ModerationPermission"("moderationConfigId", "commandType", "roleId");

-- CreateIndex
CREATE INDEX "Blacklist_guildId_idx" ON "Blacklist"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "Blacklist_guildId_userId_key" ON "Blacklist"("guildId", "userId");

-- CreateIndex
CREATE INDEX "CastigoRecord_guildId_userId_idx" ON "CastigoRecord"("guildId", "userId");

-- CreateIndex
CREATE INDEX "CastigoRecord_expiresAt_idx" ON "CastigoRecord"("expiresAt");

-- CreateIndex
CREATE INDEX "InviteStat_guildId_uses_idx" ON "InviteStat"("guildId", "uses");

-- CreateIndex
CREATE UNIQUE INDEX "InviteStat_globalConfigId_guildId_inviterId_key" ON "InviteStat"("globalConfigId", "guildId", "inviterId");

-- CreateIndex
CREATE INDEX "InviteEvent_guildId_inviterId_idx" ON "InviteEvent"("guildId", "inviterId");

-- CreateIndex
CREATE INDEX "ChannelCleanerPanel_channelId_idx" ON "ChannelCleanerPanel"("channelId");

-- CreateIndex
CREATE INDEX "ChannelCleanerPanel_globalConfigId_isActive_idx" ON "ChannelCleanerPanel"("globalConfigId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MutePermission_globalConfigId_commandType_roleId_key" ON "MutePermission"("globalConfigId", "commandType", "roleId");

-- CreateIndex
CREATE INDEX "CommandPermissionGlobal_commandName_idx" ON "CommandPermissionGlobal"("commandName");

-- CreateIndex
CREATE UNIQUE INDEX "CommandPermissionGlobal_globalConfigId_commandName_roleId_key" ON "CommandPermissionGlobal"("globalConfigId", "commandName", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_threadId_key" ON "SupportTicket"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedUserGlobal_userId_key" ON "VerifiedUserGlobal"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotConfig_guildId_key" ON "SnapshotConfig"("guildId");

-- CreateIndex
CREATE INDEX "SnapshotConfig_enabled_idx" ON "SnapshotConfig"("enabled");

-- CreateIndex
CREATE INDEX "SnapshotTarget_channelId_idx" ON "SnapshotTarget"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotTarget_configId_channelId_key" ON "SnapshotTarget"("configId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "UserStatGlobal_guildId_userId_key" ON "UserStatGlobal"("guildId", "userId");

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
