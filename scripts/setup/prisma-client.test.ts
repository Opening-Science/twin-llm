import { describe, expect, test } from "bun:test";

import { clientState, embeddedSchema } from "./prisma-client";

const SCHEMA = 'model UserSkill {\n  id String @id\n  name String // "quoted"\n}\n';
const classSource = (schema: string) =>
  `const config = {\n  "previewFeatures": [],\n  "inlineSchema": ${JSON.stringify(schema)},\n  "runtimeDataModel": {}\n}`;

describe("embeddedSchema", () => {
  test("reads the schema back, escapes and all", () => {
    expect(embeddedSchema(classSource(SCHEMA))).toBe(SCHEMA);
  });

  test("a client without an inline schema gives null", () => {
    expect(embeddedSchema("export const x = 1")).toBeNull();
  });
});

describe("clientState", () => {
  test("same schema is ok", () => {
    expect(clientState(SCHEMA, classSource(SCHEMA))).toBe("ok");
  });

  test("a model added since the last generate is stale", () => {
    expect(
      clientState(`${SCHEMA}model Extra {\n  id String @id\n}\n`, classSource(SCHEMA)),
    ).toBe("stale");
  });

  test("no client at all is missing", () => {
    expect(clientState(SCHEMA, null)).toBe("missing");
  });
});
