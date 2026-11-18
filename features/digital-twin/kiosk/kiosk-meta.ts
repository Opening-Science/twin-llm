import { type Metadata } from "next";

/**
 * The kiosk page's metadata. The page needs no sign-in, so on a hosted
 * deployment anyone with the address can open it; it is a screen in a room,
 * not a page to be found, so it asks search engines to leave it out.
 */
export const KIOSK_METADATA: Metadata = {
  title: "Kiosk · TwinLLM",
  description: "The digital twin of a synthetic person, for a portrait screen.",
  robots: { index: false, follow: false },
};
