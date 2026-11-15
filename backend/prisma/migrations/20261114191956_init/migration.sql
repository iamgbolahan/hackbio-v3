-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('M', 'F');

-- CreateEnum
CREATE TYPE "Source" AS ENUM ('bio_monitor', 'glucose_sensor', 'manual_entry', 'mock');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('low', 'moderate', 'high');

-- CreateEnum
CREATE TYPE "SignalQuality" AS ENUM ('OK', 'LOW', 'ARTIFACT');

-- CreateEnum
CREATE TYPE "HealthStatus" AS ENUM ('NORMAL', 'WATCH', 'ATTENTION');

-- CreateEnum
CREATE TYPE "TestCondition" AS ENUM ('normal_earth', 'head_down_tilt', 'dry_immersion', 'raised_co2', 'reduced_pressure');

-- CreateEnum
CREATE TYPE "UltrasoundCondition" AS ENUM ('normal_earth', 'spaceflight');

-- CreateEnum
CREATE TYPE "BaselineParameter" AS ENUM ('resp_rate_bpm', 'spo2_pct', 'sbp_mmhg', 'dbp_mmhg');

-- CreateEnum
CREATE TYPE "StreamParameter" AS ENUM ('resp_rate_bpm', 'spo2_pct', 'sbp_mmhg', 'dbp_mmhg', 'glucose_mgdl');

-- CreateTable
CREATE TABLE "astronauts" (
    "id" TEXT NOT NULL,
    "sex" "Sex" NOT NULL,
    "launchDay" INTEGER NOT NULL,
    "displayName" TEXT NOT NULL,
    "crewNumber" TEXT NOT NULL,
    "missionName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "astronauts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "readings" (
    "id" SERIAL NOT NULL,
    "timestampUtc" TIMESTAMP(3) NOT NULL,
    "astronautId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "source" "Source" NOT NULL,
    "inFlight" BOOLEAN NOT NULL,
    "activityLevel" "ActivityLevel" NOT NULL,
    "respRateBpm" DOUBLE PRECISION,
    "spo2Pct" DOUBLE PRECISION,
    "sbpMmhg" DOUBLE PRECISION,
    "dbpMmhg" DOUBLE PRECISION,
    "glucoseMgdl" DOUBLE PRECISION,
    "fasting" BOOLEAN,
    "signalQuality" "SignalQuality" NOT NULL,
    "missionDay" INTEGER,
    "scenarioTag" TEXT,
    "status" "HealthStatus",
    "evaluation" JSONB,
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baseline_sessions" (
    "sessionId" TEXT NOT NULL,
    "astronautId" TEXT NOT NULL,
    "sessionStartUtc" TIMESTAMP(3) NOT NULL,
    "testCondition" "TestCondition" NOT NULL,
    "context" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "respRateBpm" DOUBLE PRECISION,
    "spo2Pct" DOUBLE PRECISION,
    "sbpMmhg" DOUBLE PRECISION,
    "dbpMmhg" DOUBLE PRECISION,
    "nBpReadings" INTEGER,
    "valid" BOOLEAN NOT NULL,
    "invalidReason" TEXT,

    CONSTRAINT "baseline_sessions_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "baseline_stats" (
    "id" SERIAL NOT NULL,
    "astronautId" TEXT NOT NULL,
    "testCondition" "TestCondition" NOT NULL,
    "parameter" "BaselineParameter" NOT NULL,
    "mean" DOUBLE PRECISION NOT NULL,
    "sd" DOUBLE PRECISION,
    "n" INTEGER NOT NULL,
    "provisional" BOOLEAN NOT NULL,
    "collectedFrom" TIMESTAMP(3) NOT NULL,
    "collectedTo" TIMESTAMP(3) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "baseline_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ultrasound_scans" (
    "id" SERIAL NOT NULL,
    "timestampUtc" TIMESTAMP(3) NOT NULL,
    "astronautId" TEXT NOT NULL,
    "source" "Source" NOT NULL,
    "inFlight" BOOLEAN NOT NULL,
    "condition" "UltrasoundCondition" NOT NULL,
    "missionDay" INTEGER,
    "ijvAreaMm2" DOUBLE PRECISION,
    "ijvFlowGrade" INTEGER,
    "onsdMm" DOUBLE PRECISION,
    "cimtMm" DOUBLE PRECISION,
    "lvefPct" DOUBLE PRECISION,
    "muscleThicknessMm" DOUBLE PRECISION,
    "muscleLossPct" DOUBLE PRECISION,
    "status" "HealthStatus" NOT NULL,
    "explanation" TEXT NOT NULL,
    "scenarioTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ultrasound_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_averages" (
    "astronautId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "parameter" "StreamParameter" NOT NULL,
    "sum" DOUBLE PRECISION NOT NULL,
    "count" INTEGER NOT NULL,
    "missionDay" INTEGER,

    CONSTRAINT "daily_averages_pkey" PRIMARY KEY ("astronautId","date","parameter")
);

-- CreateTable
CREATE TABLE "data_gaps" (
    "id" SERIAL NOT NULL,
    "astronautId" TEXT NOT NULL,
    "source" "Source" NOT NULL,
    "gapStart" TIMESTAMP(3) NOT NULL,
    "gapEnd" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,

    CONSTRAINT "data_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "readings_astronautId_timestampUtc_idx" ON "readings"("astronautId", "timestampUtc");

-- CreateIndex
CREATE UNIQUE INDEX "readings_timestampUtc_astronautId_source_key" ON "readings"("timestampUtc", "astronautId", "source");

-- CreateIndex
CREATE INDEX "baseline_sessions_astronautId_testCondition_idx" ON "baseline_sessions"("astronautId", "testCondition");

-- CreateIndex
CREATE UNIQUE INDEX "baseline_stats_astronautId_testCondition_parameter_key" ON "baseline_stats"("astronautId", "testCondition", "parameter");

-- CreateIndex
CREATE UNIQUE INDEX "ultrasound_scans_astronautId_timestampUtc_key" ON "ultrasound_scans"("astronautId", "timestampUtc");

-- CreateIndex
CREATE UNIQUE INDEX "data_gaps_astronautId_source_gapStart_key" ON "data_gaps"("astronautId", "source", "gapStart");

-- AddForeignKey
ALTER TABLE "readings" ADD CONSTRAINT "readings_astronautId_fkey" FOREIGN KEY ("astronautId") REFERENCES "astronauts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baseline_sessions" ADD CONSTRAINT "baseline_sessions_astronautId_fkey" FOREIGN KEY ("astronautId") REFERENCES "astronauts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baseline_stats" ADD CONSTRAINT "baseline_stats_astronautId_fkey" FOREIGN KEY ("astronautId") REFERENCES "astronauts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ultrasound_scans" ADD CONSTRAINT "ultrasound_scans_astronautId_fkey" FOREIGN KEY ("astronautId") REFERENCES "astronauts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_averages" ADD CONSTRAINT "daily_averages_astronautId_fkey" FOREIGN KEY ("astronautId") REFERENCES "astronauts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_gaps" ADD CONSTRAINT "data_gaps_astronautId_fkey" FOREIGN KEY ("astronautId") REFERENCES "astronauts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
