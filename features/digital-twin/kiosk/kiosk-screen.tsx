"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

import { subscribeNever, useWebglAvailable } from "../scan-scene";
import {
  KIOSK_FOOTER,
  KIOSK_NEEDS_WEBGL,
  KIOSK_SUBTITLE,
  KIOSK_TITLE,
} from "./kiosk-copy";

const KioskTwin = dynamic(() => import("./kiosk-twin").then((mod) => mod.KioskTwin), {
  ssr: false,
});

/**
 * The kiosk: one portrait screen, the twin standing full length in the
 * middle, the title above and the research line below. Built for an 85-inch
 * portrait panel (1080 × 1920 and up); on a landscape screen the same column
 * stands in the centre.
 *
 * The kiosk is always dark, whatever the machine's setting: the pale body
 * reads against a dark room, and nobody at a kiosk picks a theme.
 */
export const KioskScreen = () => {
  const webgl = useWebglAvailable();
  // The probe answers only after hydration; until then neither the twin nor the note shows.
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  return (
    <div className="kiosk dark">
      <header className="kiosk-head">
        <h1 className="kiosk-title">{KIOSK_TITLE}</h1>
        <p className="kiosk-subtitle">{KIOSK_SUBTITLE}</p>
      </header>
      <div className="kiosk-stage">
        {webgl ? (
          <KioskTwin />
        ) : hydrated ? (
          <p className="kiosk-twin-note">{KIOSK_NEEDS_WEBGL}</p>
        ) : null}
      </div>
      <footer className="kiosk-foot">
        <p>{KIOSK_FOOTER}</p>
      </footer>
    </div>
  );
};
