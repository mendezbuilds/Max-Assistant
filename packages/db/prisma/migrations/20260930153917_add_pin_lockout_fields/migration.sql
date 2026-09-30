-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DegenHunterUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" TEXT NOT NULL,
    "username" TEXT,
    "paperWalletBalance" DECIMAL NOT NULL DEFAULT 0,
    "pinHash" TEXT,
    "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" DATETIME,
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "minScoreThreshold" INTEGER NOT NULL DEFAULT 50,
    "riskLevelFilter" TEXT,
    "notifyOnNewTokens" BOOLEAN NOT NULL DEFAULT true,
    "lastActive" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_DegenHunterUser" ("alertsEnabled", "chatId", "createdAt", "id", "lastActive", "minScoreThreshold", "notifyOnNewTokens", "paperWalletBalance", "pinHash", "riskLevelFilter", "updatedAt", "username") SELECT "alertsEnabled", "chatId", "createdAt", "id", "lastActive", "minScoreThreshold", "notifyOnNewTokens", "paperWalletBalance", "pinHash", "riskLevelFilter", "updatedAt", "username" FROM "DegenHunterUser";
DROP TABLE "DegenHunterUser";
ALTER TABLE "new_DegenHunterUser" RENAME TO "DegenHunterUser";
CREATE UNIQUE INDEX "DegenHunterUser_chatId_key" ON "DegenHunterUser"("chatId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
