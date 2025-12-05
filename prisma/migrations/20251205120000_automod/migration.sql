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

-- CreateIndex
CREATE UNIQUE INDEX "AutoModConfig_globalConfigId_key" ON "AutoModConfig"("globalConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoModBlockedWord_autoModConfigId_word_key" ON "AutoModBlockedWord"("autoModConfigId", "word");
