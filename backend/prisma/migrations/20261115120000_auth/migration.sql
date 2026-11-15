-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('astronaut', 'flight_surgeon', 'admin');

-- CreateEnum
CREATE TYPE "AuthMethod" AS ENUM ('passcode', 'biometric');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "astronautId" TEXT,
    "passcodeHash" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "mustChangePasscode" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkey_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL,
    "transports" TEXT[],
    "deviceLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "passkey_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" "AuthMethod" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bio_monitor_devices" (
    "deviceId" TEXT NOT NULL,
    "astronautId" TEXT NOT NULL,
    "pairingHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bio_monitor_devices_pkey" PRIMARY KEY ("deviceId")
);

-- CreateTable
CREATE TABLE "monitoring_sessions" (
    "sessionId" TEXT NOT NULL,
    "astronautId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "verifiedByUserId" TEXT NOT NULL,
    "missionDay" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "monitoring_sessions_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "loginId" TEXT,
    "astronautId" TEXT,
    "action" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ip" TEXT,
    "detail" JSONB,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_loginId_key" ON "users"("loginId");
CREATE UNIQUE INDEX "users_astronautId_key" ON "users"("astronautId");
CREATE INDEX "passkey_credentials_userId_idx" ON "passkey_credentials"("userId");
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions"("userId");
CREATE INDEX "monitoring_sessions_astronautId_endedAt_idx" ON "monitoring_sessions"("astronautId", "endedAt");
CREATE INDEX "audit_log_userId_at_idx" ON "audit_log"("userId", "at");
CREATE INDEX "audit_log_astronautId_at_idx" ON "audit_log"("astronautId", "at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_astronautId_fkey" FOREIGN KEY ("astronautId") REFERENCES "astronauts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bio_monitor_devices" ADD CONSTRAINT "bio_monitor_devices_astronautId_fkey" FOREIGN KEY ("astronautId") REFERENCES "astronauts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "monitoring_sessions" ADD CONSTRAINT "monitoring_sessions_astronautId_fkey" FOREIGN KEY ("astronautId") REFERENCES "astronauts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "monitoring_sessions" ADD CONSTRAINT "monitoring_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "bio_monitor_devices"("deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;
