"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { glucoseEffectApiUrl } from "@/packages/anatomy/effects";

import { disposeObject3D } from "../dispose-object";
import { nextAutoRotateDelay } from "../frame-pacing";
import { createGlucoseFlow, type GlucoseStatus } from "./glucose-flow";

type Flow = ReturnType<typeof createGlucoseFlow>;

/** The parsed companion, or null when the route says it is not installed. */
const loadGlucoseEffect = async () => {
  const response = await fetch(glucoseEffectApiUrl());
  if (response.status === 404) {
    const body: unknown = await response.json().catch(() => null);
    if (
      typeof body === "object" &&
      body !== null &&
      "installed" in body &&
      body.installed === false
    )
      return null;
  }
  if (!response.ok) throw new Error(`Glucose effect answered ${response.status}`);
  return new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
};

export type GlucoseParticlesModel = Readonly<{
  density: number;
  retry: number;
  status: GlucoseStatus;
  onStatus: (status: GlucoseStatus) => void;
}>;

/** Owns only the companion GLB; the caller supplies the atlas-level placement. */
export const GlucoseParticles = ({
  model,
  reducedMotion,
  vesselsVisible,
}: Readonly<{
  model: GlucoseParticlesModel;
  reducedMotion: boolean;
  vesselsVisible: () => boolean;
}>) => {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const [flow, setFlow] = useState<Flow | null>(null);
  const visibleRef = useRef(true);
  const lastFrameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const { onStatus, retry, density } = model;

  useEffect(() => {
    let cancelled = false;
    let owned: Flow | null = null;
    onStatus("loading");
    loadGlucoseEffect()
      .then((gltf) => {
        if (cancelled) {
          if (gltf) disposeObject3D(gltf.scene);
          return;
        }
        if (!gltf) {
          onStatus("missing");
          return;
        }
        try {
          owned = createGlucoseFlow(gltf.scene, gltf.animations);
          setFlow(owned);
          onStatus("ready");
          invalidate();
        } catch (error) {
          disposeObject3D(gltf.scene);
          console.error("[anatomy] Glucose effect rejected", error);
          onStatus("error");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("[anatomy] Glucose effect could not be loaded", error);
        onStatus("error");
      });
    return () => {
      cancelled = true;
      setFlow(null);
      if (owned) {
        owned.dispose();
        owned.root.removeFromParent();
        disposeObject3D(owned.root);
      }
      onStatus("idle");
    };
  }, [retry, onStatus, invalidate]);

  useEffect(() => {
    flow?.setDensity(density);
    invalidate();
  }, [flow, density, reducedMotion, invalidate]);

  useEffect(() => {
    const onVisibility = () => {
      lastFrameRef.current = null;
      if (!document.hidden) invalidate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            visibleRef.current = entries.some((entry) => entry.isIntersecting);
            lastFrameRef.current = null;
            if (visibleRef.current) invalidate();
          });
    observer?.observe(gl.domElement);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [gl, invalidate]);

  useFrame(() => {
    if (!flow) return;
    const visible = density > 0 && vesselsVisible();
    Object.assign(flow.root, { visible });
    const running = visible && !reducedMotion && visibleRef.current && !document.hidden;
    if (!running) {
      lastFrameRef.current = null;
      return;
    }
    const now = performance.now();
    if (lastFrameRef.current !== null) {
      flow.update(Math.min((now - lastFrameRef.current) / 1000, 0.1));
    }
    lastFrameRef.current = now;
    if (timerRef.current !== null) return;
    const wait = nextAutoRotateDelay({
      lastDrawMs: now,
      nowMs: performance.now(),
      visible: true,
    });
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      invalidate();
    }, wait ?? 0);
  });

  return flow ? <primitive object={flow.root} /> : null;
};
