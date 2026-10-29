"use client";

import { useEffect, useState, type FormEvent } from "react";

import { formatDate, formatNumber, withUnit } from "@/infrastructure/format-measure";
import { Button, buttonClassName } from "@/infrastructure/ui-kit/button";
import { Card } from "@/infrastructure/ui-kit/card";
import { Field } from "@/infrastructure/ui-kit/field";
import { StatusBadge, type StatusTone } from "@/infrastructure/ui-kit/status-badge";

import {
  DEFAULT_SYNTHEA_OPTIONS,
  MAX_AGE,
  MAX_SEED,
  SYNTHEA_FORMAT_LABELS,
  SYNTHEA_FORMATS,
  SYNTHEA_MODULE_KEYS,
  SYNTHEA_MODULES,
  SYNTHEA_STATES,
  type SyntheaFormat,
  type SyntheaModule,
  type SyntheaOptions,
  type SyntheaSex,
} from "./synthea-options";
import { type PatientPreview } from "./synthea-output";
import { type JobState, type JobView } from "./synthea-queue";

/**
 * The generator form, the job's progress and the result. Options are a closed
 * set; the server checks them again with the same schema. The page polls the
 * job once a second until it ends.
 */

const POLL_MS = 1000;
const API = "/api/synthea/jobs";

const SEX_LABELS: Readonly<Record<SyntheaSex, string>> = {
  any: "Any",
  female: "Female only",
  male: "Male only",
};

const STATE_TEXT: Readonly<
  Record<JobState, Readonly<{ tone: StatusTone; text: string }>>
> = {
  queued: { tone: "neutral", text: "Waiting" },
  running: { tone: "neutral", text: "Running" },
  done: { tone: "ok", text: "Ready" },
  failed: { tone: "warn", text: "Failed" },
  "timed-out": { tone: "warn", text: "Took too long" },
  expired: { tone: "off", text: "Expired" },
  downloaded: { tone: "ok", text: "Downloaded" },
};

const FINAL: ReadonlySet<JobState> = new Set(["failed", "timed-out", "expired"]);

type Form = Readonly<{
  people: string;
  seed: string;
  ageMin: string;
  ageMax: string;
  sex: SyntheaSex;
  state: SyntheaOptions["state"];
  modules: readonly SyntheaModule[];
  formats: readonly SyntheaFormat[];
}>;

const INITIAL_FORM: Form = {
  people: String(DEFAULT_SYNTHEA_OPTIONS.people),
  seed: "",
  ageMin: String(DEFAULT_SYNTHEA_OPTIONS.ageMin),
  ageMax: String(DEFAULT_SYNTHEA_OPTIONS.ageMax),
  sex: DEFAULT_SYNTHEA_OPTIONS.sex,
  state: DEFAULT_SYNTHEA_OPTIONS.state,
  modules: DEFAULT_SYNTHEA_OPTIONS.modules,
  formats: DEFAULT_SYNTHEA_OPTIONS.formats,
};

const wholeNumber = (text: string): number =>
  /^\d+$/.test(text.trim()) ? Number(text) : NaN;

/** The request body; the server decides whether it is acceptable. */
const requestBody = (form: Form) => ({
  people: wholeNumber(form.people),
  seed: form.seed.trim() === "" ? null : wholeNumber(form.seed),
  ageMin: wholeNumber(form.ageMin),
  ageMax: wholeNumber(form.ageMax),
  sex: form.sex,
  state: form.state,
  modules: form.modules,
  formats: form.formats,
});

const toggle = <T extends string>(list: readonly T[], value: T): readonly T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

const errorOf = async (response: Response): Promise<string> => {
  const body: unknown = await response.json().catch(() => null);
  const error =
    typeof body === "object" && body !== null ? Reflect.get(body, "error") : undefined;
  return typeof error === "string" ? error : "Something went wrong. Try again.";
};

const jobOf = async (response: Response): Promise<JobView | null> => {
  const body: unknown = await response.json().catch(() => null);
  const job = typeof body === "object" && body !== null ? Reflect.get(body, "job") : null;
  return typeof job === "object" && job !== null ? (job as JobView) : null;
};

export const SyntheaGenerator = ({
  maxPeople,
  ready,
  timeoutMinutes,
}: Readonly<{ maxPeople: number; ready: boolean; timeoutMinutes: number }>) => {
  const [form, setForm] = useState<Form>(INITIAL_FORM);
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const jobId = job?.id ?? null;
  const active = job?.state === "queued" || job?.state === "running";

  useEffect(() => {
    if (jobId === null || !active) return;
    const timer = setInterval(() => {
      void fetch(`${API}/${jobId}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) {
            setError(await errorOf(response));
            setJob(null);
            return;
          }
          const next = await jobOf(response);
          if (next !== null) setJob(next);
        })
        .catch(() => setError("The server could not be reached. Try again."));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [jobId, active]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSending(true);
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody(form)),
      });
      if (!response.ok) {
        setError(await errorOf(response));
        return;
      }
      setJob(await jobOf(response));
    } catch {
      setError("The server could not be reached. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
        <Card padding="md" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Number of people"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxPeople}
            required
            value={form.people}
            onChange={(event) => set("people", event.target.value)}
            hint={`1 to ${maxPeople} on this server.`}
          />
          <Field
            label="Seed (optional)"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_SEED}
            value={form.seed}
            onChange={(event) => set("seed", event.target.value)}
            hint="The same options and seed give the same people. Empty picks one for you."
          />
          <Field
            label="Lowest age"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_AGE}
            required
            value={form.ageMin}
            onChange={(event) => set("ageMin", event.target.value)}
          />
          <Field
            label="Highest age"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_AGE}
            required
            value={form.ageMax}
            onChange={(event) => set("ageMax", event.target.value)}
          />
          <Field
            as="select"
            label="Sex"
            value={form.sex}
            onChange={(event) =>
              set(
                "sex",
                event.target.value === "female" || event.target.value === "male"
                  ? event.target.value
                  : "any",
              )
            }
          >
            {(Object.keys(SEX_LABELS) as SyntheaSex[]).map((sex) => (
              <option key={sex} value={sex}>
                {SEX_LABELS[sex]}
              </option>
            ))}
          </Field>
          <Field
            as="select"
            label="US state"
            value={form.state}
            onChange={(event) => {
              const state = SYNTHEA_STATES.find((name) => name === event.target.value);
              if (state !== undefined) set("state", state);
            }}
            hint="Synthea's population data covers the United States only."
          >
            {SYNTHEA_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </Field>
        </Card>

        <Card padding="md" className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-muted-foreground mb-1 text-xs font-medium">
              Modules
            </legend>
            <p className="text-muted-foreground text-xs">
              None picked runs every Synthea module. Picking some runs only those, plus
              check-ups, allergies and medication review so records still have vital signs
              and labs.
            </p>
            <div className="flex flex-wrap gap-2">
              {SYNTHEA_MODULE_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="chip"
                  aria-pressed={form.modules.includes(key)}
                  onClick={() => set("modules", toggle(form.modules, key))}
                >
                  {SYNTHEA_MODULES[key].label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-muted-foreground mb-1 text-xs font-medium">
              Output
            </legend>
            {SYNTHEA_FORMATS.map((format) => (
              <label key={format} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={form.formats.includes(format)}
                  onChange={() => set("formats", toggle(form.formats, format))}
                />
                {SYNTHEA_FORMAT_LABELS[format]}
              </label>
            ))}
          </fieldset>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={!ready || sending || active}>
            {active ? "Generating…" : "Generate"}
          </Button>
          <p className="text-muted-foreground text-xs">
            One run at a time on this server; a run stops after{" "}
            {formatNumber(timeoutMinutes, 0)} min.
          </p>
        </div>
        {!ready && (
          <p className="text-destructive text-sm" role="status">
            The generator is not set up on this server yet.
          </p>
        )}
        {error !== null && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </form>

      {job !== null && (
        <JobPanel
          job={job}
          onDownloaded={() => setJob({ ...job, state: "downloaded" })}
        />
      )}
    </div>
  );
};

const JobPanel = ({
  job,
  onDownloaded,
}: Readonly<{ job: JobView; onDownloaded: () => void }>) => {
  const label = STATE_TEXT[job.state];
  return (
    <Card as="section" padding="md" className="flex flex-col gap-4">
      <div
        className="flex flex-wrap items-center justify-between gap-2"
        aria-live="polite"
      >
        <h2 className="text-lg font-medium">This run</h2>
        <StatusBadge tone={label.tone}>{label.text}</StatusBadge>
      </div>
      <p className="text-muted-foreground font-mono text-xs">
        Seed {job.seed} · {job.people} {job.people === 1 ? "person" : "people"}
      </p>
      {job.state === "queued" && (
        <p className="text-sm">
          {job.position === 1
            ? "Next in line. Another run is finishing."
            : `Number ${job.position ?? "?"} in line.`}
        </p>
      )}
      {job.state === "running" && (
        <div className="flex flex-col gap-1">
          <progress
            aria-label="People generated"
            max={job.people}
            value={job.done}
            className="h-1.5 w-full"
          />
          <p className="text-muted-foreground text-xs">
            {job.done} of {job.people} people. Java starts first, which takes a few
            seconds.
          </p>
        </div>
      )}
      {job.state === "done" && (
        <div className="flex flex-col gap-2">
          <a
            href={`${API}/${job.id}/download`}
            download
            onClick={onDownloaded}
            className={buttonClassName({ variant: "primary", className: "self-start" })}
          >
            Download zip
          </a>
          <p className="text-muted-foreground text-xs">
            {job.patientFiles ?? 0} patient files. Synthea also writes records for people
            who died during the simulation, so there can be more files than people. The
            zip can be downloaded once, within 10 minutes; then it is deleted.
          </p>
        </div>
      )}
      {job.state === "downloaded" && (
        <p className="text-sm">Downloaded. The files are deleted from the server.</p>
      )}
      {FINAL.has(job.state) && (
        <p className="text-sm">
          {job.state === "timed-out"
            ? "The run took too long and was stopped. Try fewer people."
            : job.state === "expired"
              ? "Nobody downloaded the result within 10 minutes, so it was deleted."
              : "The run did not finish. Try again; if it keeps failing, try other options."}
        </p>
      )}
      {job.preview !== null && <PreviewCard preview={job.preview} />}
    </Card>
  );
};

const COUNT_LABELS: Readonly<Record<keyof PatientPreview["counts"], string>> = {
  conditions: "Conditions",
  observations: "Observations",
  encounters: "Encounters",
  medicationRequests: "Medication requests",
  procedures: "Procedures",
  immunizations: "Immunizations",
};

const SEX_WORDS: Readonly<Record<string, string>> = {
  female: "Female",
  male: "Male",
  other: "Other",
};

const formatValue = (value: number): string =>
  formatNumber(value, Number.isInteger(value) ? 0 : 1);

const PreviewCard = ({ preview }: Readonly<{ preview: PatientPreview }>) => (
  <div className="border-border flex flex-col gap-3 border-t pt-4">
    <div>
      <h3 className="text-eyebrow">One generated person</h3>
      <p className="text-sm">
        {SEX_WORDS[preview.sex] ?? "Sex not recorded"}, born{" "}
        {formatDate(preview.birthDate)}
        {preview.deceasedDate !== null
          ? `, died ${formatDate(preview.deceasedDate)}`
          : ""}
      </p>
    </div>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
      {(Object.keys(COUNT_LABELS) as (keyof PatientPreview["counts"])[]).map((key) => (
        <div key={key}>
          <dt className="text-muted-foreground text-xs">{COUNT_LABELS[key]}</dt>
          <dd className="font-mono text-sm">{formatNumber(preview.counts[key], 0)}</dd>
        </div>
      ))}
    </dl>
    {preview.conditions.length > 0 && (
      <div>
        <h4 className="text-muted-foreground text-xs font-medium">First conditions</h4>
        <ul className="text-sm">
          {preview.conditions.map((line, index) => (
            <li key={`${line.label}-${index}`} className="flex justify-between gap-3">
              <span className="min-w-0 break-words">{line.label}</span>
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {formatDate(line.detail)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    )}
    {preview.observations.length > 0 && (
      <div>
        <h4 className="text-muted-foreground text-xs font-medium">Latest measurements</h4>
        <ul className="text-sm">
          {preview.observations.map((line, index) => (
            <li key={`${line.label}-${index}`} className="flex justify-between gap-3">
              <span className="min-w-0 break-words">{line.label}</span>
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {withUnit(formatValue(line.value), line.unit)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
);
