import { describe, expect, test } from "bun:test";
import { Box3, PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  applyHeartFocus,
  bodyCameraFocus,
  heartCameraFocus,
  HEART_FOCUS_SECONDS,
  BODY_RESET_SECONDS,
} from "./heart-focus";
import { fitCameraToBox } from "./scan-scene";

const fixture = (aspect: number) => {
  const camera = new PerspectiveCamera(40, aspect, 0.01, 40);
  camera.up.set(0, 0, 1);
  camera.position.set(0, -3, 1);
  const controls = new OrbitControls(camera);
  controls.target.set(0, 0, 1);
  controls.minDistance = 0.25;
  controls.maxDistance = 6;
  controls.update();
  const box = new Box3(new Vector3(-0.06, -0.03, 1.2), new Vector3(0.06, 0.05, 1.35));
  return { camera, controls, box };
};

describe("heart camera focus", () => {
  test("centres on the heart and fits it in portrait and landscape without clipping", () => {
    for (const aspect of [0.5, 1, 2]) {
      const { camera, controls, box } = fixture(aspect);
      const focus = heartCameraFocus(camera, controls, box);
      applyHeartFocus(camera, controls, focus, 1);
      expect(controls.target.equals(box.getCenter(new Vector3()))).toBe(true);
      const distance = camera.position.distanceTo(controls.target);
      expect(distance).toBeLessThan(3);
      expect(distance).toBeGreaterThanOrEqual(controls.minDistance);
      expect(distance).toBeLessThanOrEqual(controls.maxDistance);
      camera.updateMatrixWorld(true);
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            const projected = new Vector3(x, y, z).project(camera);
            expect(Math.abs(projected.x)).toBeLessThan(1);
            expect(Math.abs(projected.y)).toBeLessThan(1);
            expect(projected.z).toBeGreaterThan(-1);
            expect(projected.z).toBeLessThan(1);
          }
    }
  });

  describe("animated full-body reset", () => {
    const body = new Box3(new Vector3(-0.3, -0.15, 0), new Vector3(0.3, 0.15, 1.8));

    test("computing a reset does not snap the camera; animation ends at the normal full-body framing", () => {
      const { camera, controls, box } = fixture(1);
      applyHeartFocus(camera, controls, heartCameraFocus(camera, controls, box), 1);
      const start = camera.position.clone();
      const request = bodyCameraFocus(camera, controls, body);
      expect(camera.position.equals(start)).toBe(true);
      expect(BODY_RESET_SECONDS).toBe(0.85);
      applyHeartFocus(camera, controls, request, 0.5);
      expect(camera.position.distanceTo(start)).toBeGreaterThan(0.1);
      expect(camera.position.distanceTo(request.position)).toBeGreaterThan(0.1);
      applyHeartFocus(camera, controls, request, 1);
      const expected = camera.clone();
      const target = fitCameraToBox(expected, body);
      expect(camera.position.distanceTo(expected.position)).toBeLessThan(1e-10);
      expect(controls.target.distanceTo(target)).toBeLessThan(1e-10);
    });

    test("returning from behind follows an outward arc rather than crossing the orbit target", () => {
      const { camera, controls } = fixture(1);
      controls.target.set(0, 0, 1.3);
      camera.position.set(0, 0.4, 1.3);
      controls.update();
      const request = bodyCameraFocus(camera, controls, body);
      let previousDistance = camera.position.distanceTo(controls.target);
      for (let step = 0; step <= 20; step += 1) {
        applyHeartFocus(camera, controls, request, step / 20);
        const distance = camera.position.distanceTo(controls.target);
        expect(distance).toBeGreaterThanOrEqual(previousDistance - 1e-10);
        expect(distance).toBeGreaterThanOrEqual(0.4 - 1e-10);
        previousDistance = distance;
      }
    });
  });

  test("eases position and target together, preserving the viewing direction and damping setting", () => {
    const { camera, controls, box } = fixture(1);
    controls.enableDamping = true;
    const focus = heartCameraFocus(camera, controls, box);
    expect(HEART_FOCUS_SECONDS).toBe(0.65);
    applyHeartFocus(camera, controls, focus, 0);
    expect(camera.position.distanceTo(focus.fromPosition)).toBeLessThan(1e-10);
    applyHeartFocus(camera, controls, focus, 0.5);
    expect(
      camera.position.distanceTo(focus.fromPosition.clone().lerp(focus.position, 0.5)),
    ).toBeLessThan(1e-10);
    applyHeartFocus(camera, controls, focus, 1);
    expect(camera.position.distanceTo(focus.position)).toBeLessThan(1e-10);
    expect(camera.position.clone().sub(controls.target).normalize().y).toBeCloseTo(
      -1,
      10,
    );
    expect(controls.enableDamping).toBe(true);
    expect(controls.autoRotate).toBe(false);
  });

  test("respects the minimum zoom distance for a small heart", () => {
    const { camera, controls } = fixture(1);
    const tiny = new Box3(
      new Vector3(-0.001, -0.001, -0.001),
      new Vector3(0.001, 0.001, 0.001),
    );
    const focus = heartCameraFocus(camera, controls, tiny);
    expect(focus.position.distanceTo(focus.target)).toBeCloseTo(0.25, 10);
  });
});
