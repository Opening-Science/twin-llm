import "server-only";

import { getLatestGoogleHealthBundle } from "@/features/google-health/connection";
import { getLatestOuraBundle } from "@/features/oura/connection";
import { getLatestWhoopBundle } from "@/features/whoop/connection";
import { database } from "@/infrastructure/database";
import { readPersonalDayObservations } from "@/infrastructure/personal-data-store";
import { append } from "@/packages/audit/append";

import {
  readPersonalReplay as readReplay,
  type PersonalReplayDeps,
} from "./your-day-personal-reader";

const deps: PersonalReplayDeps = {
  readPersonalDayObservations,
  getLatestOuraBundle,
  getLatestWhoopBundle,
  getLatestGoogleHealthBundle,
  append: (input) => append(database(), input),
};

export const readPersonalReplay = (
  actor: string,
  userId: string,
  day: string,
  zone: string,
) => readReplay(deps, actor, userId, day, zone);
