-- Scheduled skill runs and the mark on the turns they ask (#54).
ALTER TABLE "turns" ADD COLUMN "scheduled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "scheduled_tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "skill" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "schedule_kind" TEXT NOT NULL,
    "time_of_day" TEXT,
    "weekday" INTEGER,
    "interval_minutes" INTEGER,
    "time_zone" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "notify" BOOLEAN NOT NULL DEFAULT false,
    "next_run_at" TIMESTAMP(3),
    "running_since" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_status" TEXT,
    "last_turn_id" TEXT,
    "unseen" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scheduled_tasks_user_id_created_at_idx" ON "scheduled_tasks"("user_id", "created_at");

CREATE INDEX "scheduled_tasks_enabled_next_run_at_idx" ON "scheduled_tasks"("enabled", "next_run_at");

ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
