import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OwnSkillHeader } from "./own-skill-header";

const noDelete = async (_form: FormData): Promise<void> => {};

/** Your own skill's page leads back to Skills, as a shipped skill's page does (#486). */
describe("OwnSkillHeader", () => {
  test("links back to the Skills list before the skill's name", () => {
    const html = renderToStaticMarkup(
      createElement(OwnSkillHeader, {
        skill: { id: "ckskill1", name: "sleep-notes" },
        deleteAction: noDelete,
      }),
    ).replaceAll("<!-- -->", "");
    const back = html.match(/<a [^>]*href="([^"]+)"[^>]*>← Skills<\/a>/);
    expect(back?.[1]).toBe("/customize");
    expect(html.indexOf("← Skills")).toBeLessThan(html.indexOf("/sleep-notes"));
  });
});
