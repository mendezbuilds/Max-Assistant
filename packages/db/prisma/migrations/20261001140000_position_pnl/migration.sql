-- Realized PnL tracking on positions: what sells actually returned, and the close.
ALTER TABLE "DegenHunterPosition" ADD COLUMN "realizedSOL" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DegenHunterPosition" ADD COLUMN "exitPriceUsd" REAL;
ALTER TABLE "DegenHunterPosition" ADD COLUMN "closedAt" DATETIME;
