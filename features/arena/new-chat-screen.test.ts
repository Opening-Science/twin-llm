import { afterAll, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { moduleMocker } from "@/tests/support/mock-module";

const mockModuleForFile = moduleMocker({ mock, afterAll });
await mockModuleForFile("next/navigation", { usePathname: () => "/" });
await mockModuleForFile("@/features/arena/compare-screen", {
  CompareScreen: ({ initialDraft }: Readonly<{ initialDraft?: string }>) =>
    createElement("main", null, `compare ${initialDraft ?? ""}`),
});

const { NewChatScreen } = await import("./new-chat-screen");

describe("NewChatScreen (#377)", () => {
  test("at / it renders the compare screen with the page's props", () => {
    const html = renderToStaticMarkup(
      createElement(NewChatScreen, {
        catalog: null,
        initialDraft: "/sleep ",
        dataMode: "synthetic",
      }),
    );
    expect(html).toBe("<main>compare /sleep </main>");
  });
});
