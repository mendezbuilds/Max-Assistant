/*
  Warnings:

  - You are about to drop the `DegenHunterTrade` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "DegenHunterWallet" ADD COLUMN "encryptedKey" TEXT;
ALTER TABLE "DegenHunterWallet" ADD COLUMN "iv" TEXT;
ALTER TABLE "DegenHunterWallet" ADD COLUMN "publicKey" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "DegenHunterTrade";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "DegenHunterPosition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "tokenSymbol" TEXT NOT NULL,
    "tokenAmount" DECIMAL NOT NULL,
    "amountSOL" DECIMAL NOT NULL,
    "entryPriceUsd" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "DegenHunterPosition_chatId_idx" ON "DegenHunterPosition"("chatId");

-- CreateIndex
CREATE INDEX "DegenHunterPosition_tokenAddress_idx" ON "DegenHunterPosition"("tokenAddress");

-- CreateIndex
CREATE INDEX "DegenHunterPosition_status_idx" ON "DegenHunterPosition"("status");
