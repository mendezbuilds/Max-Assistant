-- CreateTable
CREATE TABLE "DegenHunterUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" TEXT NOT NULL,
    "username" TEXT,
    "paperWalletBalance" DECIMAL NOT NULL DEFAULT 0,
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "minScoreThreshold" INTEGER NOT NULL DEFAULT 50,
    "riskLevelFilter" TEXT,
    "notifyOnNewTokens" BOOLEAN NOT NULL DEFAULT true,
    "lastActive" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DegenHunterWallet" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" TEXT NOT NULL,
    "balance" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DegenHunterWatchlist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DegenHunterMutedToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "mutedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DegenHunterIgnoredToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "ignoredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DegenHunterTrade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "tokenSymbol" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "amountSOL" DECIMAL NOT NULL,
    "amountUSD" DECIMAL NOT NULL,
    "priceAtBuy" DECIMAL NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isPaperTrade" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "DegenHunterRecentToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tokenId" TEXT NOT NULL,
    "tokenData" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "DegenHunterUser_chatId_key" ON "DegenHunterUser"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "DegenHunterWallet_chatId_key" ON "DegenHunterWallet"("chatId");

-- CreateIndex
CREATE INDEX "DegenHunterWatchlist_chatId_idx" ON "DegenHunterWatchlist"("chatId");

-- CreateIndex
CREATE INDEX "DegenHunterWatchlist_tokenAddress_idx" ON "DegenHunterWatchlist"("tokenAddress");

-- CreateIndex
CREATE UNIQUE INDEX "DegenHunterWatchlist_chatId_tokenAddress_key" ON "DegenHunterWatchlist"("chatId", "tokenAddress");

-- CreateIndex
CREATE INDEX "DegenHunterMutedToken_chatId_idx" ON "DegenHunterMutedToken"("chatId");

-- CreateIndex
CREATE INDEX "DegenHunterMutedToken_tokenAddress_idx" ON "DegenHunterMutedToken"("tokenAddress");

-- CreateIndex
CREATE UNIQUE INDEX "DegenHunterMutedToken_chatId_tokenAddress_key" ON "DegenHunterMutedToken"("chatId", "tokenAddress");

-- CreateIndex
CREATE INDEX "DegenHunterIgnoredToken_chatId_idx" ON "DegenHunterIgnoredToken"("chatId");

-- CreateIndex
CREATE INDEX "DegenHunterIgnoredToken_tokenAddress_idx" ON "DegenHunterIgnoredToken"("tokenAddress");

-- CreateIndex
CREATE UNIQUE INDEX "DegenHunterIgnoredToken_chatId_tokenAddress_key" ON "DegenHunterIgnoredToken"("chatId", "tokenAddress");

-- CreateIndex
CREATE INDEX "DegenHunterTrade_chatId_idx" ON "DegenHunterTrade"("chatId");

-- CreateIndex
CREATE INDEX "DegenHunterTrade_tokenAddress_idx" ON "DegenHunterTrade"("tokenAddress");

-- CreateIndex
CREATE INDEX "DegenHunterTrade_timestamp_idx" ON "DegenHunterTrade"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "DegenHunterRecentToken_tokenId_key" ON "DegenHunterRecentToken"("tokenId");

-- CreateIndex
CREATE INDEX "DegenHunterRecentToken_tokenId_idx" ON "DegenHunterRecentToken"("tokenId");
