import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { KitCard } from "../kit-cards";
import { AccuracyDetails, AccuracyDisclosure } from "./accuracy-disclosure";
import { cardAccuracy } from "./card-accuracy";

const card = (id: string, label: string): KitCard => ({
  id,
  chart: "month",
  label,
  category: "sleep",
  sentence: "",
  state: "default",
  current: { month: "November", value: 450, display: "7 hr 30 min" },
  previous: { month: "October", value: 440, display: "7 hr 20 min" },
});

const ouraSleep = cardAccuracy("oura", card("month:sleep.duration.", "Sleep: Duration"))!;

/** The text a reader gets, tags dropped and entities read back. */
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

describe("AccuracyDisclosure", () => {
  const html = renderToStaticMarkup(
    <AccuracyDisclosure accuracy={ouraSleep} label="Sleep: Duration" />,
  );

  test("is a closed button that names its card and opens a dialog", () => {
    const button = html.match(/<button[^>]*>/)![0];
    expect(button).toContain('type="button"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(text(html)).toBe("How accurate is this? Sleep: Duration");
  });

  test("puts nothing in the card's grid cell but the toggle while closed", () => {
    expect(html.match(/<[a-z]+/g)).toEqual(["<button", "<span"]);
  });
});

describe("AccuracyDetails", () => {
  test("says the evidence level in words, the funding, and links each paper by DOI", () => {
    const html = renderToStaticMarkup(<AccuracyDetails accuracy={ouraSleep} />);
    const body = text(html);
    expect(body).toContain("Validated");
    expect(body).toContain(
      "Funding and interests: Both studies were funded or supported by Oura.",
    );
    expect(
      [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)/g)].map((m) => `${m[1]} ${m[2]}`),
    ).toEqual([
      "https://doi.org/10.3390/s24206532 doi:10.3390/s24206532",
      "https://doi.org/10.1016/j.sleep.2024.01.020 doi:10.1016/j.sleep.2024.01.020",
    ]);
    expect(body).toContain(
      "Robbins R, Weaver MD, Sullivan JP, et al. Accuracy of Three Commercial Wearable Devices for Sleep Tracking in Healthy Adults. Sensors. 2024;24(20):6532.",
    );
    expect(body).toContain("checked against the paper on 9 Nov 2026");
  });

  test("a composite score reads No validation found, with no funding line or links", () => {
    const readiness = cardAccuracy("oura", card("month:readiness.score.", "Readiness"))!;
    const html = renderToStaticMarkup(<AccuracyDetails accuracy={readiness} />);
    expect(text(html)).toContain("No validation found");
    expect(text(html)).not.toContain("Funding and interests");
    expect(html).not.toContain("<a ");
  });

  test("Google Health says which device family the note is for", () => {
    const heart = cardAccuracy(
      "google-health",
      card("daily:google.daily-resting-heart-rate.", "Heart: Resting"),
    )!;
    const body = text(renderToStaticMarkup(<AccuracyDetails accuracy={heart} />));
    expect(body).toContain(
      "Google Health does not say which device recorded this, so this is the note for Fitbit, the closest device family.",
    );
    expect(body).toContain("Limited evidence");
  });
});
