-- Heart rate and skin temperature (simulated, provisional ranges).
ALTER TYPE "StreamParameter" ADD VALUE IF NOT EXISTS 'hr_bpm';
ALTER TYPE "StreamParameter" ADD VALUE IF NOT EXISTS 'skin_temp_c';
ALTER TABLE "readings" ADD COLUMN "hrBpm" DOUBLE PRECISION, ADD COLUMN "skinTempC" DOUBLE PRECISION;
-- Earlier readings have no heart rate or skin temperature: clear them so history is regenerated with both.
DELETE FROM "daily_averages";
DELETE FROM "data_gaps";
DELETE FROM "readings";
