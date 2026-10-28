-- Apple Health (#178) and wearable export files (#179) are two more import kinds.
-- Allowed values, by hand: Prisma has no CHECK syntax.
ALTER TABLE "personal_datasets" DROP CONSTRAINT "personal_datasets_kind_check";
ALTER TABLE "personal_datasets" ADD CONSTRAINT "personal_datasets_kind_check" CHECK ("kind" IN ('fhir', 'lab-csv', 'table', 'apple-health', 'wearable'));
