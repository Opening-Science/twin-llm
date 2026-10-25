import { describe, expect, test } from "bun:test";

import { isLoopbackUrl } from "./loopback";

describe("isLoopbackUrl", () => {
  test.each([
    "http://localhost:11434/v1",
    "http://LOCALHOST:11434",
    "http://127.0.0.1:11434/v1",
    "http://127.10.20.30",
    "http://[::1]:11434/v1",
  ])("accepts %s", (url) => {
    expect(isLoopbackUrl(url)).toBe(true);
  });

  test.each([
    "https://api.infomaniak.com/2/ai/1/openai/v1",
    "http://192.168.1.20:11434/v1",
    "http://10.0.0.5:8000/v1",
    "http://0.0.0.0:11434",
    "http://localhost.example.com:11434",
    "http://127.0.0.1.nip.io:11434",
    "http://127.0.0.300",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(isLoopbackUrl(url)).toBe(false);
  });
});
