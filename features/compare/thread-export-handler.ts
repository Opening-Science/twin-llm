import {
  CATEGORY,
  type Disclosure,
  type RecordDisclosure,
  sendDecision,
} from "@/infrastructure/disclosure-ledger";
import {
  type CheckFreeText,
  type FreeTextCheck,
  hasGenomeShapedText,
} from "@/infrastructure/free-text-check";
import { genomeThreadRefusedEvent } from "@/infrastructure/genome-thread-audit";
import {
  GENOME_THREAD_EXPORT_REFUSED_AUDIT_TOOL,
  GENOME_THREAD_SENTENCE,
  historyShowsGenome,
  permitGenomeThreadExport,
  toolPartsUseGenome,
} from "@/infrastructure/genome-thread-policy";
import type { AppendInput } from "@/packages/audit/append";

import {
  type ExportStep,
  GENOME_IDS_EXPORT_SENTENCE,
  NOT_RECORDED_SENTENCE,
  noticeLine,
  UNCONFIRMED_SENTENCE,
} from "./export-notice";
import { fhirDocument, fhirFileName } from "./thread-fhir";
import {
  type ExportableThread,
  markdownFileName,
  threadMarkdown,
} from "./thread-markdown";
import { printPage } from "./thread-print";

/**
 * `GET /api/threads/<id>/export` (SERVER-SPEC 3.7): two requests make an
 * export. The check answers one notice line; the confirmed request writes
 * the ledger row and its paired audit row before any file is returned. An
 * unconfirmed request is refused before anything is read. A genome thread
 * leaves only to this machine, and a file holding the person's own genome
 * identifiers is never made.
 */

export type ExportFormat = "markdown" | "fhir" | "print";

export const exportFormat = (value: string | null): ExportFormat =>
  value === "fhir" || value === "print" ? value : "markdown";

export type ThreadExportDeps = Readonly<{
  loadOwnedThread: (threadId: string) => Promise<ExportableThread | null>;
  actorId: () => Promise<string | null>;
  recipientIsLocal: () => boolean;
  appendAudit: (input: AppendInput) => Promise<unknown>;
  recordDisclosure: RecordDisclosure;
  freeTextChecker: (actor: string, typed: readonly string[]) => CheckFreeText;
  dataMode: () => "synthetic" | "personal";
  today: () => string;
}>;

const NO_STORE = { "cache-control": "no-store" } as const;

const plain = (status: number, text: string): Response =>
  new Response(text, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...NO_STORE },
  });

const notice = (status: "ready" | "refused", line: string): Response =>
  Response.json({ status, line }, { headers: NO_STORE });

const usesGenome = (thread: ExportableThread): boolean =>
  historyShowsGenome(
    thread.turns.map((turn) => ({
      role: "user",
      content: turn.skill ? `/${turn.skill} ${turn.prompt}` : turn.prompt,
    })),
  ) ||
  thread.turns.some((turn) =>
    turn.answers.some((answer) => toolPartsUseGenome(answer.tools ?? [])),
  );

const answerCount = (thread: ExportableThread): number =>
  thread.turns.reduce((sum, turn) => sum + turn.answers.length, 0);

const ranTools = (thread: ExportableThread): boolean =>
  thread.turns.some((turn) =>
    turn.answers.some((answer) => (answer.tools ?? []).length > 0),
  );

const kindsAndCounts = (check: FreeTextCheck | undefined) =>
  check?.matches.map((match) => ({ ...match })) ?? null;

const fileOf = (
  format: ExportFormat,
  title: string,
  markdown: string,
  today: string,
): Response => {
  if (format === "print") {
    return new Response(printPage(title, markdown), {
      headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE },
    });
  }
  const fhir = format === "fhir";
  return new Response(
    fhir ? JSON.stringify(fhirDocument(title, markdown, today), null, 2) : markdown,
    {
      headers: {
        "content-type": fhir
          ? "application/fhir+json; charset=utf-8"
          : "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${fhir ? fhirFileName(title) : markdownFileName(title)}"`,
        ...NO_STORE,
      },
    },
  );
};

export const createThreadExportHandler =
  (deps: ThreadExportDeps) =>
  async (threadId: string, format: ExportFormat, step: ExportStep): Promise<Response> => {
    if (step === "unconfirmed") return plain(428, UNCONFIRMED_SENTENCE);
    const thread = await deps.loadOwnedThread(threadId);
    const actor = await deps.actorId();
    if (thread === null || actor === null) return plain(404, "Not found");

    const refuse = (line: string): Response =>
      step === "check" ? notice("refused", line) : plain(403, line);

    if (
      !permitGenomeThreadExport({
        genomeThread: usesGenome(thread),
        recipientIsLocal: deps.recipientIsLocal(),
      }).ok
    ) {
      await deps.appendAudit(
        genomeThreadRefusedEvent({
          actor,
          sessionId: threadId,
          threadId,
          provider: "download",
          tool: GENOME_THREAD_EXPORT_REFUSED_AUDIT_TOOL,
        }),
      );
      return refuse(GENOME_THREAD_SENTENCE);
    }

    const today = deps.today();
    const markdown = threadMarkdown(thread, today);
    const typed = thread.turns.map((turn) => turn.prompt);
    const checked = await deps
      .freeTextChecker(
        actor,
        typed,
      )(markdown)
      .then((check) => ({ status: "checked" as const, check }))
      .catch(() => ({
        status: "failed" as const,
        genomeShaped: hasGenomeShapedText(markdown),
      }));
    const decision = sendDecision(checked);
    const synthetic = deps.dataMode() === "synthetic";
    const disclosure: Disclosure = {
      actor,
      sessionId: threadId,
      kind: "export-file",
      recipient: "export file",
      target: format,
      purpose: "thread export",
      categories: [
        CATEGORY.question,
        CATEGORY.answers,
        ...(ranTools(thread) ? [CATEGORY.tools] : []),
      ],
      refs: [],
      payloadBytes: Buffer.byteLength(markdown, "utf8"),
      threadId,
      synthetic,
      ...(decision.freeText === undefined ? {} : { freeText: decision.freeText }),
    };

    if (decision.blocked) {
      await deps
        .recordDisclosure({ ...disclosure, direction: "blocked" })
        .catch((error: unknown) => {
          console.error(
            "[export] the blocked export was not recorded",
            error instanceof Error ? error.name : "unknown",
          );
        });
      return refuse(GENOME_IDS_EXPORT_SENTENCE);
    }

    if (step === "check") {
      await deps.appendAudit({
        actor,
        sessionId: threadId,
        subjectRef: null,
        tool: "thread.export.check",
        args: { format },
        result: {
          checked: checked.status === "checked",
          freeText: kindsAndCounts(decision.freeText),
        },
        rowCount: thread.turns.length,
      });
      return notice(
        "ready",
        noticeLine(checked.status === "checked" ? checked.check : null),
      );
    }

    try {
      await deps.recordDisclosure(disclosure, {
        actor,
        sessionId: threadId,
        subjectRef: null,
        tool: "thread.export",
        args: { format },
        result: {
          // Characters, as before; the ledger row counts UTF-8 bytes.
          size: markdown.length,
          freeText: kindsAndCounts(decision.freeText),
        },
        rowCount: answerCount(thread),
      });
    } catch {
      return plain(500, NOT_RECORDED_SENTENCE);
    }
    return fileOf(format, thread.title, markdown, today);
  };
