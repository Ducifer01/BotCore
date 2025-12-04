-- AlterTable
ALTER TABLE "GlobalConfig" ADD COLUMN "supportLogChannelId" TEXT;
ALTER TABLE "GlobalConfig" ADD COLUMN "supportPanelChannelId" TEXT;

-- CreateTable
CREATE TABLE "SupportRoleGlobal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "globalConfigId" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "SupportRoleGlobal_globalConfigId_fkey" FOREIGN KEY ("globalConfigId") REFERENCES "GlobalConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportRoleGlobal_globalConfigId_roleId_key" ON "SupportRoleGlobal"("globalConfigId", "roleId");
