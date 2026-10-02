-- Brute-force lockout state for the dashboard login password.
CREATE TABLE "LoginLockout" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" BIGINT
);
