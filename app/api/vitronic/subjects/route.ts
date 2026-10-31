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
import { withUnlocked } from "@/infrastructure/vault-runtime";

const subjectsDeps = {
  vitronicEnv,
  resolveActorId,
  findAppUserId,
  listVitronicSubjects,
  createVitronicSubject,
};

export const GET = withUnlocked(createVitronicSubjectsGetHandler(subjectsDeps));
export const POST = withUnlocked(createVitronicSubjectsPostHandler(subjectsDeps));
