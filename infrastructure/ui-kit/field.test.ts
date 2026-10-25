import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Field } from "./field";

const attr = (html: string, name: string, tag: string): string | undefined =>
  new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`).exec(html)?.[1];

describe("Field", () => {
  test("binds the label to the input by for/id", () => {
    const html = renderToStaticMarkup(
      createElement(Field, { label: "Scanner URL", name: "baseUrl", type: "url" }),
    );
    const id = attr(html, "id", "input");
    expect(id).toBeDefined();
    expect(attr(html, "for", "label")).toBe(id);
    expect(html).toContain('name="baseUrl"');
    expect(html).not.toContain("aria-describedby=");
    expect(html).not.toContain("aria-invalid=");
  });

  test("ties the hint to the control with aria-describedby", () => {
    const html = renderToStaticMarkup(
      createElement(Field, { label: "Token name", hint: "Optional." }),
    );
    const described = attr(html, "aria-describedby", "input");
    expect(described).toBe(`${attr(html, "id", "input")}-note`);
    expect(html).toContain(
      `<p id="${described}" class="text-xs text-muted-foreground">Optional.</p>`,
    );
  });

  test("keeps a caller's aria-describedby and appends the note id", () => {
    const html = renderToStaticMarkup(
      createElement(Field, {
        label: "Upload secret",
        hint: "Shown once.",
        "aria-describedby": "secret-help",
      }),
    );
    expect(attr(html, "aria-describedby", "input")).toBe(
      `secret-help ${attr(html, "id", "input")}-note`,
    );
  });

  test("passes a caller's aria-describedby through when there is no note", () => {
    const html = renderToStaticMarkup(
      createElement(Field, { label: "Token name", "aria-describedby": "token-help" }),
    );
    expect(attr(html, "aria-describedby", "input")).toBe("token-help");
  });

  test("an error replaces the hint and marks the control invalid", () => {
    const html = renderToStaticMarkup(
      createElement(Field, {
        label: "Scan key",
        hint: "A number.",
        error: "Use a whole number.",
      }),
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Use a whole number.");
    expect(html).not.toContain("A number.");
  });

  test("renders a select when asked", () => {
    const html = renderToStaticMarkup(
      createElement(
        Field,
        { as: "select", label: "Source" },
        createElement("option", { value: "oura" }, "Oura"),
      ),
    );
    expect(attr(html, "for", "label")).toBe(attr(html, "id", "select"));
    expect(html).toContain('<option value="oura">Oura</option>');
    expect(html).not.toContain("<input");
  });
});
