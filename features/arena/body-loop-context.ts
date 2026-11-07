"use client";

import { createContext, useContext } from "react";

/**
 * Whether the server has BodyLoop configured, for the chat's twins (the `/twin`
 * card and a `twin.body` view). The compare screen provides it from the page's
 * settings (`arena-settings.ts`); with it off the body viewer starts on the
 * demo and makes no subjects call (#499). Outside the compare screen it is
 * true, the body viewer's own default.
 */
export const BodyLoopContext = createContext(true);

export const useBodyLoopConfigured = (): boolean => useContext(BodyLoopContext);
