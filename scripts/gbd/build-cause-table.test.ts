import { describe, expect, test } from "bun:test";

import { buildCauses } from "./build-cause-table";

/** A cut-down cause.py in the vivarium-gbd-mapping layout; the restrictions are left out. */
const cause = (key: string, id: number, level: number): string => `    '${key}': Cause(
        name='${key}',
        kind='cause',
        gbd_id=c_id(${id}),
        me_id=UNKNOWN,
        level=${level},
        most_detailed=False,
        parent=None,
    ),`;

const file = (blocks: readonly string[], parents: readonly string[]): string =>
  [
    "causes = Causes(**{",
    ...blocks,
    "})",
    "",
    ...parents.map((line) => `${line}\n`),
  ].join("\n");

describe("build-cause-table", () => {
  test("reads ids, levels and parents, sorted by id", () => {
    const text = file(
      [
        cause("all_causes", 294, 0),
        cause("cardiovascular_diseases", 491, 2),
        cause("non_communicable_diseases", 409, 1),
      ],
      [
        "causes.non_communicable_diseases.parent = causes.all_causes",
        "causes.cardiovascular_diseases.parent = causes.non_communicable_diseases",
      ],
    );
    expect(buildCauses(text)).toEqual([
      { id: 294, parentId: null, level: 0, name: "all_causes" },
      { id: 409, parentId: 294, level: 1, name: "non_communicable_diseases" },
      { id: 491, parentId: 409, level: 2, name: "cardiovascular_diseases" },
    ]);
  });

  test("refuses a missing parent, a level that skips one, or no causes", () => {
    expect(() => buildCauses(file([cause("injuries", 687, 1)], []))).toThrow(
      "has no parent",
    );
    expect(() =>
      buildCauses(
        file(
          [cause("all_causes", 294, 0), cause("injuries", 687, 2)],
          ["causes.injuries.parent = causes.all_causes"],
        ),
      ),
    ).toThrow("not one level below");
    expect(() => buildCauses("nothing here")).toThrow("no causes found");
  });
});
