"use client";

import { useId, useState, useTransition } from "react";

import { Button } from "@/infrastructure/ui-kit/button";
import { Card } from "@/infrastructure/ui-kit/card";
import { Rating } from "@/infrastructure/ui-kit/rating";

import { exportFileName, noReferenceText } from "./rated-set-copy";
import { exportRatings, saveRating } from "./rating-actions";
import { type BlindLine } from "./rater-lines";
import { nextIndex, progressText, ratedCount, resumeIndex } from "./rater-progress";
import { type RatedSet, type Rubric, rubricLabels, rubricOf } from "./rater-rubric";

/**
 * The second-rater view (#351): one answer at a time, with its question and
 * the reference, a 1 to 5 rating with a written anchor per level from the
 * set's rubric (hb or v1h, #304), and a comment. It never sees a run, a model or an automatic score (`BlindLine`).
 * Each save goes to the server action, which writes the ratings file beside
 * the run; reloading the page resumes at the first unrated answer.
 */

type Props = Readonly<{
  set: RatedSet;
  rater: string;
  lines: readonly BlindLine[];
  canSave: boolean;
}>;

const Anchors = ({
  rubric,
  chosen,
}: Readonly<{ rubric: Rubric; chosen: number | null }>) => (
  <dl className="rater-anchors">
    {[...rubric.levels].reverse().map((each) => (
      <div
        key={each.level}
        className="rater-anchor"
        data-chosen={chosen === each.level ? "" : undefined}
      >
        <dt>
          {each.level} · {each.label}
        </dt>
        <dd>{each.anchor}</dd>
      </div>
    ))}
  </dl>
);

const LineView = ({
  set,
  line,
  canSave,
  saving,
  onSave,
}: Readonly<{
  set: RatedSet;
  line: BlindLine;
  canSave: boolean;
  saving: boolean;
  onSave: (level: number | null, comment: string) => void;
}>) => {
  const [level, setLevel] = useState<number | null>(line.level);
  const [comment, setComment] = useState(line.comment);
  const commentId = useId();
  const rubric = rubricOf(set);
  const changed = level !== line.level || comment.trim() !== line.comment;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card padding="md" className="flex min-w-0 flex-col gap-3">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Question
        </h2>
        <p className="leading-relaxed">{line.question}</p>
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Reference
        </h2>
        {line.reference.length > 0 ? (
          <ul className="list-disc pl-5 text-sm leading-relaxed">
            {line.reference.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            {noReferenceText(set, line.referenceKind)}
          </p>
        )}
        {line.note !== null && (
          <p className="text-muted-foreground text-sm leading-relaxed">{line.note}</p>
        )}
      </Card>
      <Card padding="md" className="flex min-w-0 flex-col gap-2">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Answer
        </h2>
        <div
          className="rater-answer"
          role="region"
          aria-label="The answer to rate"
          tabIndex={0}
        >
          {line.answer}
        </div>
      </Card>
      <Card padding="md" className="flex min-w-0 flex-col gap-3">
        <Rating
          label="Your rating"
          value={level}
          onChange={setLevel}
          labels={rubricLabels(rubric)}
          readOnly={!canSave}
        />
        <Anchors rubric={rubric} chosen={level} />
        <div className="flex flex-col gap-1">
          <label
            htmlFor={commentId}
            className="text-muted-foreground text-xs font-medium"
          >
            Comment (optional)
          </label>
          <textarea
            id={commentId}
            className="rater-comment"
            rows={2}
            maxLength={2000}
            value={comment}
            disabled={!canSave}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!canSave || saving || level === null}
            onClick={() => onSave(level, comment)}
          >
            {changed || line.level === null ? "Save and next" : "Saved, next"}
          </Button>
          {line.level !== null && (
            <Button
              variant="ghost"
              disabled={!canSave || saving}
              onClick={() => onSave(null, "")}
            >
              Clear rating
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
};

export const SecondRater = ({ set, rater, lines: initial, canSave }: Props) => {
  const [lines, setLines] = useState<readonly BlindLine[]>(initial);
  const [index, setIndex] = useState(() => resumeIndex(initial));
  const [status, setStatus] = useState("");
  const [saving, startSaving] = useTransition();
  const line = lines[index];
  const done = lines.length > 0 && ratedCount(lines) === lines.length;

  const save = (level: number | null, comment: string) => {
    if (line === undefined) return;
    startSaving(async () => {
      const result = await saveRating({ set, rater, token: line.token, level, comment });
      if (!result.ok) {
        setStatus(result.message);
        return;
      }
      const next = lines.map((each, at) =>
        at === index
          ? { ...each, level, comment: level === null ? "" : comment.trim() }
          : each,
      );
      setLines(next);
      setStatus(level === null ? "Rating cleared." : "Saved.");
      if (level !== null) setIndex(nextIndex(next, index));
    });
  };

  const download = () => {
    startSaving(async () => {
      const result = await exportRatings(rater, set);
      if (!result.ok) {
        setStatus(result.message);
        return;
      }
      const url = URL.createObjectURL(
        new Blob([result.value], { type: "application/json" }),
      );
      const link = Object.assign(document.createElement("a"), {
        href: url,
        download: exportFileName(set, rater),
      });
      link.click();
      URL.revokeObjectURL(url);
      setStatus("Exported.");
    });
  };

  if (line === undefined) return null;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-medium">{progressText(lines, index)}</span>
          <span className="text-muted-foreground">
            {" "}
            · set {set} · rater {rater}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            Previous
          </Button>
          <Button
            size="sm"
            disabled={index === lines.length - 1}
            onClick={() => setIndex(index + 1)}
          >
            Next
          </Button>
          <Button size="sm" disabled={!done || saving} onClick={download}>
            Export ratings
          </Button>
        </div>
      </div>
      <div
        className="rater-progress"
        role="progressbar"
        aria-label="Answers rated"
        aria-valuemin={0}
        aria-valuemax={lines.length}
        aria-valuenow={ratedCount(lines)}
      >
        <div
          className="rater-progress-bar"
          style={{ width: `${(ratedCount(lines) / lines.length) * 100}%` }}
        />
      </div>
      {!done && (
        <p className="text-muted-foreground text-xs">
          Export opens once every answer is rated, since the file names each run.
        </p>
      )}
      <p className="text-muted-foreground min-h-4 text-xs" role="status">
        {status}
      </p>
      <LineView
        key={line.token}
        set={set}
        line={line}
        canSave={canSave}
        saving={saving}
        onSave={save}
      />
    </div>
  );
};
