-- Watchlist performance tracking: baseline price + milestone/rug state.
ALTER TABLE "DegenHunterWatchlist" ADD COLUMN "baselinePriceUsd" REAL;
ALTER TABLE "DegenHunterWatchlist" ADD COLUMN "lastMultiple" REAL;
ALTER TABLE "DegenHunterWatchlist" ADD COLUMN "xAlertLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DegenHunterWatchlist" ADD COLUMN "dropAlerted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DegenHunterWatchlist" ADD COLUMN "ruggedAt" DATETIME;
