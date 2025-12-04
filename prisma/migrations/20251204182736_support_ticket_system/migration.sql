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

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_threadId_key" ON "SupportTicket"("threadId");
