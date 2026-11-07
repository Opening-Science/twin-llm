import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { BodyLoopContext, useBodyLoopConfigured } from "./body-loop-context";

const Probe = () => <p>{useBodyLoopConfigured() ? "configured" : "off"}</p>;

describe("BodyLoopContext", () => {
  test("a chat twin under the compare screen's provider reads the server's state", () => {
    expect(
      renderToStaticMarkup(
        <BodyLoopContext value={false}>
          <Probe />
        </BodyLoopContext>,
      ),
    ).toContain("off");
    expect(
      renderToStaticMarkup(
        <BodyLoopContext value={true}>
          <Probe />
        </BodyLoopContext>,
      ),
    ).toContain("configured");
  });

  test("outside the compare screen it keeps the body viewer's default", () => {
    expect(renderToStaticMarkup(<Probe />)).toContain("configured");
  });
});
