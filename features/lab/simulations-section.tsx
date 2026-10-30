import { Card } from "@/infrastructure/ui-kit/card";
import { Field } from "@/infrastructure/ui-kit/field";
import { Button } from "@/infrastructure/ui-kit/button";
import { Legend } from "@/infrastructure/ui-kit/legend";

import { DownloadButton } from "./download-button";
import { type Evidence } from "./lab-check";
import { LabTable } from "./lab-table";
import {
  type MadeRecording,
  type SimulationData,
  type SimulationOutcome,
} from "./load-simulation";
import { SignalChart } from "./signal-chart";
import { SIM_RECORDING, SIM_SECONDS, SIMULATION_COHORT } from "./simulation-request";

/**
 * The Simulations section: a plain GET form (so a recording has a link that
 * makes it again) and, once submitted, the recording the rhythm simulator
 * makes for that synthetic person, with the `rhythm_irregularity` metrics
 * and the simulator's own settings. Server-rendered except the two charts
 * and the download buttons.
 */

const EvidenceList = ({ items }: Readonly<{ items: readonly Evidence[] }>) => (
  <dl className="lab-evidence">
    {items.map((item) => (
      <div key={item.label} className="contents">
        <dt>{item.label}</dt>
        <dd className={item.mono ? "font-mono" : undefined}>{item.value}</dd>
      </div>
    ))}
  </dl>
);

const SubHeading = ({ children }: Readonly<{ children: string }>) => (
  <h4 className="text-sm font-medium">{children}</h4>
);

const Recording = ({ recording }: Readonly<{ recording: MadeRecording }>) => (
  <div className="flex flex-col gap-4">
    <Card as="article" padding="md" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h3 className="text-base font-medium">{recording.title}</h3>
        <p className="text-muted-foreground text-sm">{recording.subjectLabel}</p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          A simulated RR-interval recording, the same one the rhythm_irregularity tool
          describes for this person, day and number. It describes the recording only.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <SubHeading>RR tachogram</SubHeading>
        <Legend
          items={[
            { id: "rr", label: "RR interval", swatchClassName: "text-chart-1" },
            ...(recording.flagged.length > 0
              ? [
                  {
                    id: "flag",
                    label: "Window marked by the research flag",
                    swatchClassName: "text-chart-3",
                  },
                ]
              : []),
          ]}
        />
        <SignalChart
          points={recording.tachogram}
          durationSec={recording.durationSec}
          label={`RR interval in ms against seconds from the first beat; ${recording.flagged.length} windows marked by the research flag`}
          valueLabel="RR interval"
          unit="ms"
          decimals={0}
          spans={recording.flagged}
        />
        <div className="flex flex-wrap gap-2">
          <DownloadButton
            label="Download intervals CSV"
            fileName={`${recording.fileStem}-intervals.csv`}
            mimeType="text/csv"
            text={recording.intervalsCsv}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SubHeading>Pulse-wave proxy, first 10 s</SubHeading>
        <SignalChart
          points={recording.pulse}
          durationSec={recording.pulseSeconds}
          label="Simulated pulse-wave proxy, arbitrary units, over the first ten seconds"
          valueLabel="Pulse proxy"
          unit=""
          decimals={3}
          height={130}
        />
        <p className="text-muted-foreground text-xs">
          A fixed pulse shape per beat at 25 Hz, arbitrary units. Not a model of the
          circulation.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <SubHeading>Irregularity metrics</SubHeading>
        {recording.summary === null ? null : <EvidenceList items={recording.summary} />}
        {recording.metricsNote === null ? null : (
          <p className="text-muted-foreground text-sm">{recording.metricsNote}</p>
        )}
        {recording.windows === null ? null : <LabTable table={recording.windows} />}
        {recording.windowsCsv === null ? null : (
          <div className="flex flex-wrap gap-2">
            <DownloadButton
              label="Download metrics CSV"
              fileName={`${recording.fileStem}-windows.csv`}
              mimeType="text/csv"
              text={recording.windowsCsv}
            />
          </div>
        )}
        <p className="text-muted-foreground text-sm leading-relaxed">
          The research flag marks a window when both conditions marked Yes below hold.
          These are research thresholds for recordings; they say nothing about a person.
        </p>
        <LabTable table={recording.thresholds} />
      </div>

      <details className="setup-disclosure flex flex-col gap-2">
        <summary>FHIR Observation (valueSampledData)</summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-muted-foreground text-xs leading-relaxed">
            The tachogram as the RR interval in progress every 250 ms, the mean heart
            rate, the pulse-wave proxy and the simulator&rsquo;s label per sample, tagged
            as test data. The start time is midnight UTC of the recording day; the
            simulator has no clock.
          </p>
          <pre
            className="command-block max-h-96 overflow-y-auto"
            aria-label="FHIR Observation JSON"
          >
            <code>{recording.observationJson}</code>
          </pre>
          <div className="flex flex-wrap gap-2">
            <DownloadButton
              label="Download FHIR JSON"
              fileName={`${recording.fileStem}.fhir.json`}
              mimeType="application/fhir+json"
              text={recording.observationJson}
            />
          </div>
        </div>
      </details>
    </Card>

    <Card as="section" padding="md" className="flex min-w-0 flex-col gap-3">
      <h3 className="text-base font-medium">
        Simulator settings (known because this person is simulated)
      </h3>
      <p className="text-muted-foreground text-sm leading-relaxed">
        What the simulator was set to and put in this recording. Shown here for the
        researcher; the rhythm_irregularity tool never gives it to a model.
      </p>
      <EvidenceList items={recording.settings} />
    </Card>
  </div>
);

const Outcome = ({ outcome }: Readonly<{ outcome: SimulationOutcome }>) => {
  switch (outcome.kind) {
    case "none":
      return null;
    case "refused":
      return (
        <Card padding="md">
          <p className="text-sm" role="status">
            {outcome.sentence}
          </p>
        </Card>
      );
    case "failed":
      return (
        <Card padding="md">
          <p className="text-sm" role="status">
            The recording could not be made just now. Reload the page to try again.
          </p>
        </Card>
      );
    case "made":
      return <Recording recording={outcome.recording} />;
  }
};

export const SimulationsSection = ({ data }: Readonly<{ data: SimulationData }>) => {
  if (data.kind === "personal") {
    return (
      <Card padding="md">
        <p className="text-sm leading-relaxed">
          Simulations are for synthetic people only. This app runs with personal data (
          <code className="setup-code">DATA_MODE=personal</code>), so the section is off.
          Start it with <code className="setup-code">DATA_MODE=synthetic</code> to make
          recordings.
        </p>
      </Card>
    );
  }
  const { form, subjects } = data;
  return (
    <div className="flex flex-col gap-4">
      <Card padding="md" className="flex min-w-0 flex-col gap-3">
        {subjects.length === 0 ? (
          <p className="text-sm leading-relaxed">
            No synthetic people of the pinned cohort ({SIMULATION_COHORT}) are in this
            database. <code className="setup-code">bun run setup:local</code> loads them.
          </p>
        ) : (
          <form
            method="get"
            action="/lab#simulations"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <Field
              as="select"
              name="subject"
              label="Synthetic person"
              defaultValue={form.values.subject}
              error={form.errors.subject}
              className="sm:col-span-2"
              required
            >
              <option value="" disabled>
                Choose a person
              </option>
              {subjects.map((subject) => (
                <option key={subject.ref} value={subject.ref}>
                  {subject.label}
                </option>
              ))}
            </Field>
            <Field
              name="date"
              type="date"
              label="Recording day"
              hint="Within the person's observations; empty means the last day."
              defaultValue={form.values.date}
              error={form.errors.date}
            />
            <Field
              name="seconds"
              type="number"
              inputMode="numeric"
              min={SIM_SECONDS.min}
              max={SIM_SECONDS.max}
              step={1}
              label="Length (s)"
              hint={`${SIM_SECONDS.min} to ${SIM_SECONDS.max}; a window needs 128 intervals, about two minutes.`}
              defaultValue={form.values.seconds}
              error={form.errors.seconds}
            />
            <Field
              name="recording"
              type="number"
              inputMode="numeric"
              min={SIM_RECORDING.min}
              max={SIM_RECORDING.max}
              step={1}
              label="Recording number"
              hint="The same number gives the same recording."
              defaultValue={form.values.recording}
              error={form.errors.recording}
            />
            <div className="flex items-end">
              <Button type="submit" variant="primary">
                Make recording
              </Button>
            </div>
          </form>
        )}
      </Card>
      <Outcome outcome={data.outcome} />
    </div>
  );
};
