-- CreateTable
CREATE TABLE "SeenItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agentKey" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SeenItem_agentKey_idx" ON "SeenItem"("agentKey");

-- CreateIndex
CREATE UNIQUE INDEX "SeenItem_agentKey_externalId_key" ON "SeenItem"("agentKey", "externalId");
