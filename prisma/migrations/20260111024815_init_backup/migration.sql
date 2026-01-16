-- CreateTable
CREATE TABLE "Backup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "backupId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT,
    "scopes" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Backup_backupId_key" ON "Backup"("backupId");
