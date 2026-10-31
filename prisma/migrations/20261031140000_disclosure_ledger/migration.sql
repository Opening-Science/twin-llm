-- The disclosure ledger (#140): one hash-chained row per event in which data leaves this machine.
-- CreateTable
CREATE TABLE "disclosure_events" (
    "seq" BIGINT NOT NULL,
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "actor" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "target" TEXT,
    "purpose" TEXT NOT NULL,
    "categories" TEXT[],
    "ref_count" INTEGER NOT NULL,
    "payload_bytes" INTEGER,
    "thread_id" TEXT,
    "synthetic" BOOLEAN NOT NULL,
    "free_text_checked" BOOLEAN NOT NULL,
    "refs" TEXT,
    "audit_seq" BIGINT NOT NULL,
    "prev_hash" CHAR(64) NOT NULL,
    "hash" CHAR(64) NOT NULL,

    CONSTRAINT "disclosure_events_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "disclosure_events_id_key" ON "disclosure_events"("id");

-- CreateIndex
CREATE INDEX "disclosure_events_actor_recipient_idx" ON "disclosure_events"("actor", "recipient");
