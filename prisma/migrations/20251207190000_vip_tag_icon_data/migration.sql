-- Add iconData column to store raw emoji assets for VIP tags
ALTER TABLE "VipTag" ADD COLUMN "iconData" BLOB;
