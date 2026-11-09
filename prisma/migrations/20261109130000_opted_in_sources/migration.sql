-- Personal-data knowledge sources a person switched on (#507); empty means they stay off.
ALTER TABLE "onboarding_profiles" ADD COLUMN "optedInSources" TEXT[] DEFAULT ARRAY[]::TEXT[];
