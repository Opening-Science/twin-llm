-- Live public lookups (#6): the sources a user switched on, off by default.
ALTER TABLE "onboarding_profiles" ADD COLUMN "liveSources" TEXT[] DEFAULT ARRAY[]::TEXT[];
