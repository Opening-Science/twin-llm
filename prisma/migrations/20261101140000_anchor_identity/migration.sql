-- Which database this is, for the signed anchors (#382). One row, written on
-- the first anchor; the anchors file records a hash of its id.
CREATE TABLE "anchor_identity" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "database_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anchor_identity_pkey" PRIMARY KEY ("id")
);
