import {
  createVitronicSubject,
  listVitronicSubjects,
} from "@/features/vitronic/connection";
import {
  createVitronicSubjectsGetHandler,
  createVitronicSubjectsPostHandler,
} from "@/features/vitronic/subjects-handler";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { vitronicEnv } from "@/infrastructure/env";

const subjectsDeps = {
  vitronicEnv,
  resolveActorId,
  findAppUserId,
  listVitronicSubjects,
  createVitronicSubject,
};

export const GET = createVitronicSubjectsGetHandler(subjectsDeps);
export const POST = createVitronicSubjectsPostHandler(subjectsDeps);
