import {
  CATEGORY,
  type Disclosure,
  type DisclosureCategory,
  type RecordDisclosure,
} from "@/infrastructure/disclosure-ledger";
import { formatDate } from "@/infrastructure/format-measure";
import { genomeThreadRefusedEvent } from "@/infrastructure/genome-thread-audit";
import {
  GENOME_THREAD_EXPORT_REFUSED_AUDIT_TOOL,
  GENOME_THREAD_SENTENCE,
  historyShowsGenome,
  permitGenomeThreadExport,
  toolPartsUseGenome,
} from "@/infrastructure/genome-thread-policy";
import { readableTitle } from "@/infrastructure/readable-title";
import type { AppendInput } from "@/packages/audit/append";

import {
  exportFileName,
  type ExportableThread,
  threadDocumentReference,
  threadMarkdown,
} from "./thread-markdown";
import { threadPrintHtml } from "./thread-print";

/**
 * `GET /api/threads/<id>/export[?format=fhir|print]`: the viewer's own thread
 * as a Markdown file, as a FHIR R4 DocumentReference carrying that same
 * Markdown (#44), or as a page for printing or saving as PDF (#213). Anyone else, or a thread that does not exist, gets the same 404, as
 * the thread page does.
 *
 * Every export writes an audit row (the format and the size; no content). A
 * thread that used the genome tools leaves only for a recipient on this
 * machine: with the app served on loopback only (`LOCAL_ONLY`), the
 * download lands on the same machine; otherwise it is refused and audited
 * (`genome-thread-policy.ts`).
 *
 * A file that leaves the app is a disclosure (#140): the export is written to
 * the disclosure ledger, paired with its `thread.export` audit row in one
 * transaction, before the file is returned. If that write fails there is no
 * file.
 */
export type ThreadExportDeps = Readonly<{
  /** The thread when the signed-in viewer owns it, else null. */
  loadOwnedThread: (threadId: string) => Promise<ExportableThread | null>;
  actorId: () => Promise<string | null>;
  /** True when the app is served to this machine only. */
  recipientIsLocal: () => boolean;
  appendAudit: (input: AppendInput) => Promise<unknown>;
  recordDisclosure: RecordDisclosure;
  dataMode: () => "synthetic" | "personal";
  today: () => string;
}>;

export const THREAD_EXPORT_AUDIT_TOOL = "thread.export" as const;

export type ExportFormat = "markdown" | "fhir" | "print";

export const exportFormat = (value: string | null): ExportFormat =>
  value === "fhir" || value === "print" ? value : "markdown";

const NO_STORE = { "Cache-Control": "no-store" };

export const EXPORT_NOT_RECORDED =
  "The export could not be recorded, so no file was made. Try again.";

/** What an export file holds: the questions and answers, and tool results when any ran. */
export const exportDisclosure = (
  thread: ExportableThread,
  call: Readonly<{
    actor: string;
    threadId: string;
    format: ExportFormat;
    bytes: number;
    mode: "synthetic" | "personal";
  }>,
): Disclosure => {
  const hasTools = thread.turns.some((turn) =>
    turn.answers.some((answer) => (answer.tools ?? []).length > 0),
  );
  const categories: readonly DisclosureCategory[] = [
    CATEGORY.question,
    CATEGORY.answers,
    ...(hasTools ? [CATEGORY.tools] : []),
  ];
  return {
    actor: call.actor,
    sessionId: call.threadId,
    kind: "export-file",
    recipient: "export file",
    target: call.format,
    purpose: "thread export",
    categories,
    refs: [],
    payloadBytes: call.bytes,
    threadId: call.threadId,
    synthetic: call.mode === "synthetic",
  };
};

const usesGenome = (thread: ExportableThread): boolean =>
  thread.turns.some(
    (turn) =>
      historyShowsGenome([{ role: "user", content: turn.prompt }]) ||
      turn.answers.some((answer) => toolPartsUseGenome(answer.tools ?? [])),
  );

export const createThreadExportHandler =
  (deps: ThreadExportDeps) =>
  async (threadId: string, format: ExportFormat = "markdown"): Promise<Response> => {
    const thread = await deps.loadOwnedThread(threadId);
    const actor = await deps.actorId();
    if (thread === null || actor === null) {
      return new Response("Not found", { status: 404, headers: NO_STORE });
    }
    const decision = permitGenomeThreadExport({
      genomeThread: usesGenome(thread),
      recipientIsLocal: deps.recipientIsLocal(),
    });
    if (!decision.ok) {
      await deps.appendAudit(
        genomeThreadRefusedEvent({
          actor,
          sessionId: threadId,
          threadId,
          provider: "download",
          tool: GENOME_THREAD_EXPORT_REFUSED_AUDIT_TOOL,
        }),
      );
      return new Response(GENOME_THREAD_SENTENCE, { status: 403, headers: NO_STORE });
    }

    const markdown = threadMarkdown(thread, formatDate(deps.today()));
    const body =
      format === "fhir"
        ? JSON.stringify(threadDocumentReference(thread, markdown, deps.today()), null, 2)
        : format === "print"
          ? threadPrintHtml(markdown, readableTitle(thread.title))
          : markdown;
    const recorded = await deps
      .recordDisclosure(
        exportDisclosure(thread, {
          actor,
          threadId,
          format,
          bytes: Buffer.byteLength(body, "utf8"),
          mode: deps.dataMode(),
        }),
        {
          actor,
          sessionId: threadId,
          subjectRef: null,
          tool: THREAD_EXPORT_AUDIT_TOOL,
          // The audit log keeps only hashes of these; the content itself is never logged.
          args: { format },
          result: { bytes: body.length },
          rowCount: thread.turns.reduce((sum, turn) => sum + turn.answers.length, 0),
        },
      )
      .then(
        () => true,
        (error: unknown) => {
          console.error(
            "[export] the disclosure ledger could not be written",
            error instanceof Error ? error.name : "unknown",
          );
          return false;
        },
      );
    if (!recorded) {
      return new Response(EXPORT_NOT_RECORDED, { status: 500, headers: NO_STORE });
    }
    if (format === "print") {
      return new Response(body, {
        headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
      });
    }
    const fileName = exportFileName(thread.title);
    return new Response(body, {
      headers: {
        "Content-Type":
          format === "fhir"
            ? "application/fhir+json; charset=utf-8"
            : "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${
          format === "fhir" ? fileName.replace(/\.md$/, ".fhir.json") : fileName
        }"`,
        ...NO_STORE,
      },
    });
  };
