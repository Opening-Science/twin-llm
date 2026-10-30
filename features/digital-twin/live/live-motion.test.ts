import { describe, expect, test } from "bun:test";
import {
  BoxGeometry,
  Color,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
} from "three";

import {
  HIGHLIGHT_COLOUR,
  HIGHLIGHT_INTENSITY,
  setHighlighted,
  setLiveGlow,
} from "../anatomy/layer-material";
import { liveTargets, setPartScale } from "./live-conditioning";
import {
  breathAt,
  HEART_GLOW,
  HEART_SCALE,
  HRV_GLOW,
  LUNG_SCALE,
  pulseAt,
  scaleAbout,
  chamberGlow,
} from "./live-motion";

describe("pulseAt", () => {
  test("a strong first beat, a softer second, then rest", () => {
    expect(pulseAt(0.08, 60)).toBe(1);
    expect(pulseAt(0.28, 60)).toBeCloseTo(0.45, 6);
    expect(pulseAt(0.6, 60)).toBeCloseTo(0, 6);
  });

  test("repeats every beat at the given rate", () => {
    expect(pulseAt(1.08, 60)).toBeCloseTo(1, 10);
    // 120 bpm: a beat every 0.5 s, so the first peak is at 0.04 s.
    expect(pulseAt(0.04, 120)).toBeCloseTo(1, 10);
    expect(pulseAt(0.54, 120)).toBeCloseTo(1, 10);
  });
});

describe("breathAt", () => {
  test("out at the start, in at half a breath, at 15 per minute", () => {
    expect(breathAt(0, 15)).toBe(0);
    expect(breathAt(1, 15)).toBeCloseTo(0.5, 10);
    expect(breathAt(2, 15)).toBeCloseTo(1, 10);
    expect(breathAt(4, 15)).toBeCloseTo(0, 10);
  });

  test("the amplitudes stay gentle", () => {
    expect([HEART_SCALE, LUNG_SCALE, HRV_GLOW]).toEqual([0.02, 0.025, 0.3]);
    expect(HEART_GLOW).toEqual({ hra: 0.5, bodyparts3d: 0.2 });
  });
});

describe("scaleAbout", () => {
  test("the centre stays put and other points move away from it", () => {
    const m = scaleAbout(new Matrix4(), new Vector3(1, 2, 3), 2);
    expect(new Vector3(1, 2, 3).applyMatrix4(m).toArray()).toEqual([1, 2, 3]);
    expect(new Vector3(2, 2, 3).applyMatrix4(m).toArray()).toEqual([3, 2, 3]);
  });
});

/** A synthetic organ: a box whose centre is (1, 1, 1) in its own space, moved to x = 5. */
const organ = () => {
  const mesh = new Mesh(
    new BoxGeometry(2, 2, 2).translate(1, 1, 1),
    new MeshStandardMaterial(),
  );
  mesh.position.set(5, 0, 0);
  mesh.updateMatrix();
  return mesh;
};

describe("setPartScale", () => {
  test("swells in place about the geometry's centre and restores exactly", () => {
    const mesh = organ();
    const before = mesh.matrix.clone();
    setPartScale(mesh, 1.1);
    expect(mesh.matrixAutoUpdate).toBe(false);
    const centre = new Vector3(1, 1, 1).applyMatrix4(mesh.matrix);
    expect(centre.toArray()).toEqual([6, 1, 1]);
    const corner = new Vector3(2, 2, 2).applyMatrix4(mesh.matrix);
    expect(corner.x).toBeCloseTo(7.1, 10);
    // Later frames scale from the same rest pose, never from the last frame.
    setPartScale(mesh, 1.02);
    setPartScale(mesh, 1);
    expect(mesh.matrix.equals(before)).toBe(true);
    expect(mesh.matrixAutoUpdate).toBe(true);
  });

  test("scale 1 on a mesh that was never scaled changes nothing", () => {
    const mesh = organ();
    const before = mesh.matrix.clone();
    setPartScale(mesh, 1);
    expect(mesh.matrix.equals(before)).toBe(true);
    expect(mesh.matrixAutoUpdate).toBe(true);
  });
});

describe("setLiveGlow", () => {
  const red = new Color(1, 0, 0);

  test("adds to the emissive and restores the look underneath exactly", () => {
    const material = new MeshStandardMaterial({
      emissive: 0x000000,
      emissiveIntensity: 1,
    });
    expect(setLiveGlow(material, 0.5, red)).toBe(true);
    expect(material.emissive.toArray()).toEqual([0.5, 0, 0]);
    expect(material.emissiveIntensity).toBe(1);
    setLiveGlow(material, 0.2, red);
    expect(material.emissive.toArray()).toEqual([0.2, 0, 0]);
    setLiveGlow(material, 0, red);
    expect(material.emissive.toArray()).toEqual([0, 0, 0]);
    expect(material.emissiveIntensity).toBe(1);
  });

  test("sits on top of the highlight, and either can end first", () => {
    const material = new MeshStandardMaterial({ color: 0x808080 });
    const plain = {
      color: material.color.clone(),
      emissive: material.emissive.clone(),
      intensity: material.emissiveIntensity,
    };
    setHighlighted(material, true);
    setLiveGlow(material, 0.5, red);
    const expected = new Color(HIGHLIGHT_COLOUR)
      .multiplyScalar(HIGHLIGHT_INTENSITY)
      .add(new Color(1, 0, 0).multiplyScalar(0.5));
    expect(material.emissive.r).toBeCloseTo(expected.r, 10);
    expect(material.emissive.g).toBeCloseTo(expected.g, 10);
    expect(material.emissive.b).toBeCloseTo(expected.b, 10);
    // The highlight ends while the glow runs: the glow stays, on the plain look.
    setHighlighted(material, false);
    expect(material.emissive.toArray()).toEqual([0.5, 0, 0]);
    setLiveGlow(material, 0, red);
    expect(material.color.equals(plain.color)).toBe(true);
    expect(material.emissive.equals(plain.emissive)).toBe(true);
    expect(material.emissiveIntensity).toBe(plain.intensity);
  });

  test("materials without standard terms are left alone", () => {
    expect(setLiveGlow(new MeshBasicMaterial(), 0.5, red)).toBe(false);
  });
});

describe("liveTargets", () => {
  const part = (
    group: string | null,
    system: "cardiovascular" | "respiratory" | "nervous",
  ) => ({
    mesh: organ(),
    group,
    system,
  });

  test("HRA: the heart group, the lungs and the brain", () => {
    const heart = part("heart", "cardiovascular");
    const lung = part("lung", "respiratory");
    const trachea = part("trachea", "respiratory");
    const brain = part("brain", "nervous");
    const targets = liveTargets("hra", [heart, lung, trachea, brain]);
    expect(targets.heart).toEqual([heart]);
    expect(targets.lungs).toEqual([lung]);
    expect(targets.hrv).toEqual([brain]);
  });

  test("BodyParts3D: whole systems, since it has no organ groups", () => {
    const vessels = part(null, "cardiovascular");
    const airways = part(null, "respiratory");
    const nerves = part(null, "nervous");
    const targets = liveTargets("bodyparts3d", [vessels, airways, nerves]);
    expect(targets.heart).toEqual([vessels]);
    expect(targets.lungs).toEqual([airways]);
    expect(targets.hrv).toEqual([nerves]);
  });
});

describe("chamberGlow", () => {
  test("full at a ventricular peak, half at an atrial one, none at rest", () => {
    expect(chamberGlow(0, 1)).toBe(0.15);
    expect(chamberGlow(1, 0)).toBe(0.075);
    expect(chamberGlow(0, 0)).toBe(0);
  });
});
