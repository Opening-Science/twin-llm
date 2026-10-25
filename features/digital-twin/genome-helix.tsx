"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, type Group, Quaternion, Vector3 } from "three";

import { GenomeHelixFallback } from "./genome-helix-fallback";

export { GenomeHelixFallback } from "./genome-helix-fallback";

/**
 * Decorative double helix. Original geometry — not a sequence renderer and
 * not seeded from VCF, FASTA, or any Ark slot. WebGL missing → static fallback.
 */

const RUNG_COUNT = 20;
const HELIX_TURNS = 1.75;
const HELIX_RADIUS = 1.05;
const HELIX_HEIGHT = 5.6;
const BACKBONE_RADIUS = 0.08;
const RUNG_RADIUS = 0.04;
const NODE_RADIUS = 0.15;

const BACKBONE_A = "#6ea8ff";
const BACKBONE_B = "#7d6bff";
const PAIR_CYCLE = [
  { left: "#8ec5ff", right: "#f4c95d" },
  { left: "#5fd0c8", right: "#ef7b6a" },
] as const;

type HelixProps = {
  readonly forceFallback?: boolean;
};

type SpherePart = {
  readonly kind: "sphere";
  readonly key: string;
  readonly position: readonly [number, number, number];
  readonly color: string;
  readonly radius: number;
};

type CylinderPart = {
  readonly kind: "cylinder";
  readonly key: string;
  readonly position: readonly [number, number, number];
  readonly quaternion: readonly [number, number, number, number];
  readonly length: number;
  readonly color: string;
  readonly radius: number;
};

type HelixPart = SpherePart | CylinderPart;

const yUp = new Vector3(0, 1, 0);

const cylinderBetween = (
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  color: string,
  radius: number,
  key: string,
): CylinderPart => {
  const from = new Vector3(...start);
  const to = new Vector3(...end);
  const dir = to.clone().sub(from);
  const length = dir.length();
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const quaternion = new Quaternion().setFromUnitVectors(yUp, dir.normalize());
  return {
    kind: "cylinder",
    key,
    position: [mid.x, mid.y, mid.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    length,
    color,
    radius,
  };
};

const buildHelixParts = (): readonly HelixPart[] => {
  const nodesA: Array<readonly [number, number, number]> = [];
  const nodesB: Array<readonly [number, number, number]> = [];
  const parts: HelixPart[] = [];

  for (let i = 0; i < RUNG_COUNT; i += 1) {
    const t = i / (RUNG_COUNT - 1);
    const angle = t * HELIX_TURNS * Math.PI * 2;
    const y = (t - 0.5) * HELIX_HEIGHT;
    const a: readonly [number, number, number] = [
      Math.cos(angle) * HELIX_RADIUS,
      y,
      Math.sin(angle) * HELIX_RADIUS,
    ];
    const b: readonly [number, number, number] = [
      Math.cos(angle + Math.PI) * HELIX_RADIUS,
      y,
      Math.sin(angle + Math.PI) * HELIX_RADIUS,
    ];
    nodesA.push(a);
    nodesB.push(b);

    const pair = i % 2 === 0 ? PAIR_CYCLE[0] : PAIR_CYCLE[1];
    parts.push({
      kind: "sphere",
      key: `node-a-${i}`,
      position: a,
      color: BACKBONE_A,
      radius: NODE_RADIUS,
    });
    parts.push({
      kind: "sphere",
      key: `node-b-${i}`,
      position: b,
      color: BACKBONE_B,
      radius: NODE_RADIUS,
    });
    parts.push(cylinderBetween(a, b, pair.left, RUNG_RADIUS, `rung-${i}`));
    const insetA: readonly [number, number, number] = [a[0] * 0.55, a[1], a[2] * 0.55];
    const insetB: readonly [number, number, number] = [b[0] * 0.55, b[1], b[2] * 0.55];
    parts.push({
      kind: "sphere",
      key: `pair-a-${i}`,
      position: insetA,
      color: pair.left,
      radius: NODE_RADIUS * 0.7,
    });
    parts.push({
      kind: "sphere",
      key: `pair-b-${i}`,
      position: insetB,
      color: pair.right,
      radius: NODE_RADIUS * 0.7,
    });
  }

  for (let i = 1; i < nodesA.length; i += 1) {
    const prevA = nodesA[i - 1];
    const nextA = nodesA[i];
    const prevB = nodesB[i - 1];
    const nextB = nodesB[i];
    if (!prevA || !nextA || !prevB || !nextB) continue;
    parts.push(cylinderBetween(prevA, nextA, BACKBONE_A, BACKBONE_RADIUS, `bone-a-${i}`));
    parts.push(cylinderBetween(prevB, nextB, BACKBONE_B, BACKBONE_RADIUS, `bone-b-${i}`));
  }

  return parts;
};

const HelixMesh = ({ part }: { readonly part: HelixPart }) => {
  const color = useMemo(() => new Color(part.color), [part.color]);
  if (part.kind === "sphere") {
    return (
      <mesh position={part.position}>
        <sphereGeometry args={[part.radius, 14, 14]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.08} />
      </mesh>
    );
  }
  return (
    <mesh position={part.position} quaternion={part.quaternion}>
      <cylinderGeometry args={[part.radius, part.radius, part.length, 10]} />
      <meshStandardMaterial color={color} roughness={0.4} metalness={0.05} />
    </mesh>
  );
};

const HelixGroup = () => {
  const group = useRef<Group>(null);
  const parts = useMemo(() => buildHelixParts(), []);

  useFrame((_, delta) => {
    const current = group.current;
    if (!current) return;
    current.rotation.y += delta * 0.28;
  });

  return (
    <group ref={group}>
      {parts.map((part) => (
        <HelixMesh key={part.key} part={part} />
      ))}
    </group>
  );
};

const webglAvailable = (): boolean => {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
};

const GenomeHelixCanvas = () => (
  <div className="wearables-hero relative h-[320px] overflow-hidden rounded-2xl">
    <Canvas
      camera={{ position: [0, 0.35, 7.1], fov: 36, near: 0.1, far: 40 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 6]} intensity={1.05} />
      <directionalLight position={[-4, -1, -3]} intensity={0.35} />
      <HelixGroup />
    </Canvas>
  </div>
);

export const GenomeHelix = ({ forceFallback = false }: HelixProps) => {
  if (forceFallback || !webglAvailable()) {
    return <GenomeHelixFallback />;
  }
  return <GenomeHelixCanvas />;
};
