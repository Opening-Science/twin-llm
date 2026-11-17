-- A marker per schema move in progress (.plans/compare-rewrite/DATA-MODEL.md
-- C.0). The chat move's row is written here and removed only by its contract
-- step. Its phase says how far the move got; db:chat-backfill reads it and
-- sets it to backfilled.

CREATE TABLE "schema_moves" (
    "move" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schema_moves_pkey" PRIMARY KEY ("move"),
    CONSTRAINT "schema_moves_phase" CHECK ("phase" IN ('expanded', 'backfilled'))
);

-- How far a move's backfill got per table, so a stopped run resumes.
CREATE TABLE "schema_move_cursors" (
    "move" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "last_id" TEXT,
    "copied" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schema_move_cursors_pkey" PRIMARY KEY ("move", "table_name")
);

ALTER TABLE "schema_move_cursors" ADD CONSTRAINT "schema_move_cursors_move_fkey" FOREIGN KEY ("move") REFERENCES "schema_moves"("move") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "schema_moves" ("move", "phase") VALUES ('chat-tables', 'expanded');
