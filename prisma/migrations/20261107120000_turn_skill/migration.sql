-- The skill the person sent a turn with (#479); null for Auto, agents and plain prompts.
ALTER TABLE "turns" ADD COLUMN "skill" TEXT;
