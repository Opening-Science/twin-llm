import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { YourDayChart } from "./your-day-chart";

test("plots the supplied readings with a daily range and the nearest cursor value", () => {
  const html = renderToStaticMarkup(
    <YourDayChart
      label="Example metric"
      unit="ms"
      initialMinute={400}
      readings={[
        { minute: 480, value: 41 },
        { minute: 0, value: 30 },
        { minute: 900, value: 55 },
      ]}
    />,
  );
  expect(html).toContain("30–55 ms");
  expect(html).toContain('aria-valuetext="08:00, 41 ms"');
  expect(html).toContain("<polyline");
  expect(html).toContain("00:00");
  expect(html).toContain("23:59");
  expect(html).not.toContain("Sample data");
});

test("renders a missing-data state without inventing a range or a cursor", () => {
  const html = renderToStaticMarkup(
    <YourDayChart label="Example metric" unit="ms" readings={[]} />,
  );
  expect(html).toContain("No readings for this day.");
  expect(html).not.toMatch(/Daily range|type="range"|<polyline/);
});
