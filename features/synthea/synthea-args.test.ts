import { describe, expect, test } from "bun:test";

import {
  buildSyntheaCommand,
  buildSyntheaProperties,
  moduleFiles,
  resolveSeed,
  RUN_README,
  runManifest,
} from "./synthea-args";
import { parseSyntheaOptions, type SyntheaOptions } from "./synthea-options";

const PATHS = {
  jarPath: "/srv/synthea.jar",
  configPath: "/tmp/job/synthea.properties",
  pathDelimiter: ":",
} as const;

const OPTIONS: SyntheaOptions = {
  people: 2,
  seed: 7,
  ageMin: 40,
  ageMax: 60,
  sex: "female",
  state: "New York",
  modules: ["hypertension", "asthma"],
  formats: ["fhir"],
};

describe("buildSyntheaCommand", () => {
  test("builds the pinned recipe's arguments", () => {
    expect(buildSyntheaCommand(OPTIONS, 7, PATHS)).toEqual({
      seed: 7,
      clinicianSeed: 8,
      args: [
        "-Duser.timezone=UTC",
        "-Xmx1536m",
        "-jar",
        "/srv/synthea.jar",
        "-c",
        "/tmp/job/synthea.properties",
        "-s",
        "7",
        "-cs",
        "8",
        "-p",
        "2",
        "-r",
        "20260101",
        "-e",
        "20260101",
        "-a",
        "40-60",
        "-g",
        "F",
        "-m",
        "wellness_encounters:allergies:med_rec:asthma:hypertension",
        "New York",
      ],
    });
  });

  test("leaves out -g and -m for any sex and every module", () => {
    const { args } = buildSyntheaCommand(
      { ...OPTIONS, sex: "any", modules: [], state: "Massachusetts" },
      42,
      PATHS,
    );
    expect(args.slice(-3)).toEqual(["-a", "40-60", "Massachusetts"]);
    expect(args.includes("-g")).toBe(false);
    expect(args.includes("-m")).toBe(false);
  });

  test("uses the server's path separator for modules", () => {
    const { args } = buildSyntheaCommand(
      { ...OPTIONS, modules: ["metabolic-syndrome"], sex: "male" },
      1,
      { ...PATHS, pathDelimiter: ";" },
    );
    expect(args.slice(-5)).toEqual([
      "-g",
      "M",
      "-m",
      "wellness_encounters;allergies;med_rec;metabolic_syndrome_disease;metabolic_syndrome_care",
      "New York",
    ]);
  });

  test("never carries request text: a state outside the list throws", () => {
    const forged = { ...OPTIONS, state: "Texas --exporter.baseDirectory=/" };
    expect(() =>
      buildSyntheaCommand(forged as unknown as SyntheaOptions, 1, PATHS),
    ).toThrow("state is not in SYNTHEA_STATES");
  });

  test("every argument from parsed options is a fixed word, a number or a path we chose", () => {
    const hostile = [
      { ...OPTIONS, state: "Ohio\n-d /" },
      { ...OPTIONS, modules: ["asthma:../x"] },
      { ...OPTIONS, people: "2 -o 100" },
      { ...OPTIONS, seed: "1; curl evil" },
    ];
    expect(hostile.map((body) => parseSyntheaOptions(body, 50).ok)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    const parsed = parseSyntheaOptions({ ...OPTIONS, seed: 2_147_483_647 }, 50);
    if (!parsed.ok) throw new Error("expected valid options");
    const { args } = buildSyntheaCommand(parsed.options, 2_147_483_647, PATHS);
    const allowed =
      /^(-[a-zA-Z]+|F|M|-Duser\.timezone=UTC|-Xmx1536m|\d+|\d+-\d+|[a-z_:]+|New York|\/srv\/synthea\.jar|\/tmp\/job\/synthea\.properties)$/;
    expect(args.filter((arg) => !allowed.test(arg))).toEqual([]);
  });
});

describe("moduleFiles", () => {
  test("is empty for every module and sorted with core modules first otherwise", () => {
    expect(moduleFiles([])).toEqual([]);
    expect(moduleFiles(["copd", "asthma"])).toEqual([
      "wellness_encounters",
      "allergies",
      "med_rec",
      "asthma",
      "copd",
    ]);
  });
});

describe("resolveSeed", () => {
  test("keeps a chosen seed and draws one otherwise", () => {
    expect(resolveSeed(5, () => 0.5)).toBe(5);
    expect(resolveSeed(0, () => 0.5)).toBe(0);
    expect(resolveSeed(null, () => 0.5)).toBe(1_073_741_823);
    expect(resolveSeed(null, () => 0)).toBe(0);
  });
});

describe("buildSyntheaProperties", () => {
  test("switches on only the chosen exporters", () => {
    expect(buildSyntheaProperties(["csv"])).toBe(
      [
        "exporter.baseDirectory = ./",
        "exporter.use_uuid_filenames = true",
        "exporter.fhir.export = false",
        "exporter.fhir.bulk_data = false",
        "exporter.hospital.fhir.export = false",
        "exporter.practitioner.fhir.export = false",
        "exporter.csv.export = true",
        "exporter.metadata.export = false",
        "exporter.ccda.export = false",
        "exporter.text.export = false",
        "exporter.json.export = false",
        "exporter.clinical_note.export = false",
        "generate.thread_pool_size = 1",
        "",
      ].join("\n"),
    );
    expect(buildSyntheaProperties(["fhir", "csv"]).split("\n").slice(2, 7)).toEqual([
      "exporter.fhir.export = true",
      "exporter.fhir.bulk_data = false",
      "exporter.hospital.fhir.export = false",
      "exporter.practitioner.fhir.export = false",
      "exporter.csv.export = true",
    ]);
  });
});

describe("runManifest", () => {
  test("records options, seeds and the pinned Synthea", () => {
    const command = buildSyntheaCommand(OPTIONS, 7, PATHS);
    expect(JSON.parse(runManifest(OPTIONS, command, 3))).toEqual({
      generator: "Synthea",
      syntheaVersion: "v4.0.0",
      jarSha256: "ed43c20ad40ba5c3bc724503a5af032715fe3c491620b766148e7c2361e6ecc1",
      synthetic: true,
      people: 2,
      patientFiles: 3,
      seed: 7,
      clinicianSeed: 8,
      age: "40-60",
      sex: "female",
      state: "New York",
      modules: ["asthma", "hypertension"],
      formats: ["fhir"],
      referenceDate: "20260101",
      endDate: "20260101",
      timezone: "UTC",
      threadPoolSize: 1,
    });
    expect(RUN_README.split("\n")[0]).toBe(
      "Synthetic patient records made with Synthea.",
    );
  });
});
