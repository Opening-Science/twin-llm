import { describe, expect, test } from "bun:test";

import { EMPTY_VALUE } from "@/infrastructure/format-measure";
import {
  connectionFinding,
  parseDatabaseConnection,
  roleFinding,
  type StorageFinding,
} from "@/infrastructure/storage-hardening";

import { storageBase, storageCheck, storageHowTo } from "./storage-check";

const HOME = "/home/synthetic-owner";
const STATE = `${HOME}/.local/share/twin-llm`;
const where = { stateDir: STATE, stateShown: "$HOME/.local/share/twin-llm" };

const goodRole = roleFinding({ superuser: false, listenAddresses: "" });
const superuser = roleFinding({ superuser: true, listenAddresses: "localhost" });
const unknownRole = roleFinding(null);
const socket = connectionFinding(
  parseDatabaseConnection(
    `postgresql://twinllm:pw@localhost/twin_llm?host=${STATE}/pg-socket`,
  ),
  where,
);

const check = (dataMode: "personal" | "synthetic", findings: readonly StorageFinding[]) =>
  storageCheck({ dataMode, vitronic: "data/vitronic", findings });

describe("storageCheck", () => {
  test("personal and owner-only is OK", () => {
    const card = check("personal", [socket, goodRole]);
    expect(card.status).toBe("ok");
    expect(card.summary).toContain("would not have started otherwise");
    expect(card.table?.rows).toEqual([
      [
        "DATABASE_URL",
        "socket in $TWINLLM_STATE_DIR",
        expect.any(String),
        "OK",
        EMPTY_VALUE,
      ],
      ["Database role", "not a superuser", "not a superuser", "OK", EMPTY_VALUE],
    ]);
  });

  test("synthetic with a superuser reports the state and starts", () => {
    const card = check("synthetic", [socket, superuser]);
    expect(card.status).toBe("not-ok");
    expect(card.summary).toContain("Synthetic mode starts with this storage");
    expect(card.summary).toContain("1 item is fixed: Database role");
    expect(card.evidence).toContainEqual({
      label: "At startup",
      value: "warns and starts",
    });
  });

  test("a check that could not run is Unknown, and nothing is Unknown-free OK", () => {
    expect(check("personal", [socket, unknownRole]).status).toBe("unknown");
    expect(check("personal", []).status).toBe("unknown");
  });

  test("no home path or password on the card", () => {
    const text = JSON.stringify(check("personal", [socket, superuser]));
    expect(text).not.toContain(HOME);
    expect(text).not.toContain(":pw@");
  });
});

describe("storageHowTo", () => {
  test("repeats the checks by hand, reading settings without printing them", () => {
    const howTo = storageHowTo("data/vitronic");
    expect(howTo.split("\n")[0]).toContain("bun run lab:storage");
    expect(howTo).toContain(
      `TWINLLM_STATE_DIR="$(grep -m1 '^TWINLLM_STATE_DIR=' .env.local`,
    );
    expect(howTo).toContain('find "$TWINLLM_STATE_DIR" data/vitronic -perm /077');
    expect(howTo).toContain("psql -w");
    expect(howTo).not.toContain("VITRONIC_DATA_DIR=");
    expect(howTo).not.toContain(HOME);
  });

  test("a mesh folder outside the repository is read from .env.local", () => {
    const howTo = storageHowTo("$VITRONIC_DATA_DIR");
    expect(howTo).toContain(`VITRONIC_DATA_DIR="$(grep -m1 '^VITRONIC_DATA_DIR='`);
    expect(howTo).toContain('find "$TWINLLM_STATE_DIR" "$VITRONIC_DATA_DIR" -perm /077');
  });

  test("the card that could not run keeps the title and command", () => {
    expect(storageBase("data/vitronic")).toEqual({
      id: "local-storage",
      title: "Local storage",
      howTo: storageHowTo("data/vitronic"),
    });
  });
});
