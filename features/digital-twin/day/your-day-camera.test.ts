import { expect, test } from "bun:test";
import { Box3, OrthographicCamera, Vector3 } from "three";

import {
  applyYourDayCameraPose,
  yourDayCameraPose,
  yourDayChartFocus,
  yourDayRegionPose,
} from "./your-day-camera";

test("maps configured replay and imported charts, but not unrelated charts", () => {
  for (const id of ["heart_rate", "resting_heart_rate", "hrv_rmssd"] as const) {
    expect(yourDayChartFocus({ id })).toBe("heart");
  }
  for (const id of ["glucose", "blood_glucose"] as const) {
    expect(yourDayChartFocus({ id })).toBe("pancreas");
  }
  expect(yourDayChartFocus({ id: "steps" })).toBeUndefined();
  const observation = {
    codeSystem: "http://loinc.org",
    code: "2345-7",
    unit: "mg/dL",
    label: "Glucose",
  };
  const imported = (row: typeof observation) =>
    yourDayChartFocus({ id: "observations:test", observations: [row] });
  expect(imported(observation)).toBe("pancreas");
  expect(imported({ ...observation, codeSystem: "vendor" })).toBeUndefined();
  expect(imported({ ...observation, code: "8867-4", unit: "/min" })).toBe("heart");
});

test("eases into an organ without changing the orbit angle, then arcs back to full body", () => {
  const body = new Box3(new Vector3(-2, 0, -1), new Vector3(2, 10, 1));
  const camera = new OrthographicCamera(-1, 1, 1, -1);
  const target = new Vector3(0, 5, 0);
  const offset = new Vector3(4, 2, 6);
  const bodyZoom = 2;
  Object.assign(camera, { zoom: bodyZoom });
  camera.position.copy(target).add(offset);

  const start = yourDayCameraPose(camera, target, bodyZoom);
  const heartPose = yourDayRegionPose(start, body, "heart");
  applyYourDayCameraPose(camera, target, bodyZoom, start, heartPose, 0.5);
  expect(target.y).toBeCloseTo((start.target.y + heartPose.target.y) / 2);
  expect(camera.zoom).toBe(5);
  applyYourDayCameraPose(camera, target, bodyZoom, start, heartPose, 1);
  const heart = target.clone();
  expect(heart.y).toBeGreaterThan(7);
  expect(camera.zoom).toBeGreaterThan(2);
  expect(camera.position.clone().sub(target).distanceTo(offset)).toBeLessThan(1e-8);

  const focused = yourDayCameraPose(camera, target, bodyZoom);
  applyYourDayCameraPose(
    camera,
    target,
    bodyZoom,
    focused,
    yourDayRegionPose(focused, body, "pancreas"),
    1,
  );
  expect(target.y).toBeLessThan(heart.y);
  expect(target.y).toBeGreaterThan(6);
  expect(body.containsPoint(target)).toBe(true);

  camera.position.copy(target).add(new Vector3(0, 0, -11));
  const behind = yourDayCameraPose(camera, target, bodyZoom);
  const fullBody = yourDayRegionPose(behind, body);
  applyYourDayCameraPose(camera, target, bodyZoom, behind, fullBody, 0.5);
  expect(camera.position.distanceTo(target)).toBeCloseTo(11);
  expect(camera.zoom).toBe(5);
  applyYourDayCameraPose(camera, target, bodyZoom, behind, fullBody, 1);
  expect(target.toArray()).toEqual([0, 5, 0]);
  expect(camera.position.toArray()).toEqual([0, 5, 11]);
  expect(camera.zoom).toBe(2);
});
