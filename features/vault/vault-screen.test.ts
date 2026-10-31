import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { VaultScreen } from "./vault-screen";

/** #350: only the recovery step, which replaces both secrets, needs a hold. */
describe("VaultScreen", () => {
  test("recover: the form's only way to submit is the hold", () => {
    const html = renderToStaticMarkup(
      createElement(VaultScreen, { initialStep: "recover" }),
    );
    expect(html).not.toContain('type="submit"');
    expect(html).toContain(
      '<span class="hold-confirm-label">Hold to replace passphrase and recovery code</span>',
    );
  });

  test("unlock: a plain submit button, since locking again undoes it", () => {
    const html = renderToStaticMarkup(
      createElement(VaultScreen, { initialStep: "unlock" }),
    );
    expect(html).toContain('type="submit"');
    expect(html).not.toContain("hold-confirm");
  });
});
