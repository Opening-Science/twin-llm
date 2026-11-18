/**
 * A static preview of the user study's trials for one arm (P6 Part B,
 * #508): what a participant would see, without the survey platform's
 * questions, order or logging. Pure: a stimulus set in, one HTML page out,
 * no script, no request to anywhere. For checking the wording and the
 * display per arm before the stimuli go to the ethics committee and the
 * platform.
 */
import { formatDate } from "../../../infrastructure/format-measure";
import { WEARABLE_SOURCE_LABEL } from "../../../infrastructure/wearable-provenance";
import { MEASURE_LABEL } from "../../../infrastructure/wearable-source-rules";
import type { Arm, StimulusSet } from "./stimuli";

const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const ARM_TITLE: Readonly<Record<Arm, string>> = {
  D0: "D0: no provenance",
  D1: "D1: provenance chip and rule line",
  D2: "D2: chip, rule line and accuracy note",
};

const STYLE = `
:root{--bg:#fff;--fg:#1d1d1f;--muted:#5f5f66;--line:#d9d9de;--card:#f6f6f8;--chip:#e8eefc}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececf0;--muted:#a8a8b0;--line:#3a3a40;--card:#1e1e22;--chip:#243049}}
*{box-sizing:border-box}body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0;padding:16px;max-width:960px;margin-inline:auto}
.note{color:var(--muted);font-size:13px}.trial{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:12px 0}
.chip{display:inline-block;background:var(--chip);border-radius:999px;padding:2px 10px;font-size:13px;margin-top:6px}
.rule,.accuracy{font-size:13px;color:var(--muted);margin:6px 0 0}.label{font-size:12px;color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left}
details{margin:12px 0}`;

export const stimulusPage = (set: StimulusSet, arm: Arm): string => {
  const trials = set.trials
    .map((trial, index) => {
      const display = trial.display[arm];
      return `<section class="trial" aria-labelledby="t${index}">
<div class="label" id="t${index}">Trial ${index + 1}</div>
<p><strong>Question.</strong> ${escape(trial.question)}</p>
<p><strong>Answer.</strong> ${escape(trial.answer)}</p>
${display.chip === null ? "" : `<span class="chip">${escape(display.chip)}</span>`}
${display.rule === null ? "" : `<p class="rule">${escape(display.rule)}</p>`}
${display.note === null ? "" : `<p class="accuracy">${escape(display.note)}</p>`}
</section>`;
    })
    .join("\n");
  const panel = set.panel
    .map(
      (row) =>
        `<tr><td>${escape(formatDate(row.day))}</td><td>${escape(MEASURE_LABEL[row.measure])}</td><td>${escape(WEARABLE_SOURCE_LABEL[row.source])}</td><td>${escape(row.shown)}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(ARM_TITLE[arm])}</title><style>${STYLE}</style></head>
<body>
<h1>${escape(set.persona.name)}'s nights: ${escape(ARM_TITLE[arm])}</h1>
<p class="note">Preview of the study's trials. ${escape(set.persona.name)} is a synthetic person; every reading is made up. No questions, no logging.</p>
<details><summary>Data: every device's readings</summary>
<table><thead><tr><th>Night</th><th>Measure</th><th>Device</th><th>Reading</th></tr></thead><tbody>${panel}</tbody></table>
</details>
${trials}
</body></html>
`;
};
