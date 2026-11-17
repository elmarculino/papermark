-- [fork] Self-hosted: new teams default to the unlimited plan.
-- Existing rows keep their plan; change them manually if needed.
ALTER TABLE "Team" ALTER COLUMN "plan" SET DEFAULT 'datarooms-unlimited';
