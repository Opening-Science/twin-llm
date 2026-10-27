import { resolveActorId } from "@/infrastructure/auth-actor";
import { database } from "@/infrastructure/database";

/**
 * Last twenty Ark and genome audit rows (`ark.*`, `genome.*`) for the signed-in
 * actor. Hash prefix only — never args, result, subject, or the full chain hash.
 */

export type ArkAuditEventView = {
  readonly seq: string;
  readonly tool: string;
  readonly ts: string;
  readonly hash8: string;
};

export type ArkAuditRow = {
  readonly seq: bigint | number;
  readonly tool: string;
  readonly ts: Date;
  readonly hash: string;
};

export type ArkAuditPorts = {
  readonly resolveActorId: () => Promise<string | null>;
  readonly findEvents: (actor: string) => Promise<readonly ArkAuditRow[]>;
};

const defaultPorts = (): ArkAuditPorts => ({
  resolveActorId,
  findEvents: (actor) =>
    database().auditEvent.findMany({
      where: {
        actor,
        OR: [{ tool: { startsWith: "ark." } }, { tool: { startsWith: "genome." } }],
      },
      orderBy: { seq: "desc" },
      take: 20,
      select: { seq: true, tool: true, ts: true, hash: true },
    }),
});

const toEvent = (row: ArkAuditRow): ArkAuditEventView => ({
  seq: String(row.seq),
  tool: row.tool,
  ts: row.ts.toISOString(),
  hash8: row.hash.slice(0, 8),
});

export const getArkAuditResponse = async (
  ports: Partial<ArkAuditPorts> = {},
): Promise<Response> => {
  const { resolveActorId: resolve, findEvents } = { ...defaultPorts(), ...ports };
  const actor = await resolve();
  if (!actor) {
    return Response.json({ error: "Sign in to view Ark audit." }, { status: 401 });
  }

  const events = (await findEvents(actor)).slice(0, 20).map(toEvent);
  return Response.json({ events });
};
