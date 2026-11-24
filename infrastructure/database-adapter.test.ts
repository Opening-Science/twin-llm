import { describe, expect, test } from "bun:test";

import { connectionConfig } from "./database-adapter";

describe("connectionConfig", () => {
  test("adds a UTC session to a plain connection string", () => {
    expect(connectionConfig("postgresql://u:p@127.0.0.1:5432/twin_llm")).toEqual({
      connectionString: "postgresql://u:p@127.0.0.1:5432/twin_llm",
      options: "-c TimeZone=UTC",
    });
  });

  test("keeps the other parameters, a socket host among them", () => {
    expect(connectionConfig("postgresql://twinllm@/twin_llm?host=/s&port=6543")).toEqual({
      connectionString: "postgresql://twinllm@/twin_llm?host=%2Fs&port=6543",
      options: "-c TimeZone=UTC",
    });
  });

  test("keeps the string's own options and puts UTC last, so it wins", () => {
    expect(
      connectionConfig(
        "postgresql://u@h/db?options=-c%20search_path%3Dapp%20-c%20TimeZone%3DEurope%2FZurich&sslmode=require",
      ),
    ).toEqual({
      connectionString: "postgresql://u@h/db?sslmode=require",
      options: "-c search_path=app -c TimeZone=Europe/Zurich -c TimeZone=UTC",
    });
  });
});
