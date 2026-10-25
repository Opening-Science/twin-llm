"use client";

import { useEffect } from "react";

/**
 * Fallback for a failure in the root layout or the shell layout, which no
 * `error.tsx` can catch. It replaces the whole document, so nothing from the
 * app is available: no providers, no fonts, no `globals.css`. Its few styles
 * are inline and use `light-dark()` with the brand colours from docs/brand.md,
 * so it reads correctly under either system theme.
 *
 * At this depth only a full reload can help, so that is the one action.
 */

const PAGE_CSS = `
  html { color-scheme: light dark; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    font: 15px/1.6 system-ui, sans-serif;
    background: light-dark(#f8f8f4, #1d1d1d);
    color: light-dark(#1d1d1d, #f8f8f4);
  }
  main {
    max-width: 448px;
    padding: 24px;
    border-radius: 12px;
    border: 1px solid light-dark(#d9d8cf, #404040);
    background: light-dark(#ffffff, #242424);
  }
  h1 { margin: 0; font-size: 16px; }
  p { margin: 8px 0 16px; font-size: 14px; color: light-dark(#646363, #c0beb2); }
  button {
    font: inherit;
    font-size: 14px;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid light-dark(#6f6e66, #828178);
    background: none;
    color: inherit;
    cursor: pointer;
  }
  button:hover { background: light-dark(#d9d8cf, #404040); }
  button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
`;

type Props = Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>;

const GlobalError = ({ error, reset }: Props) => {
  useEffect(() => {
    // The digest links this to the server log; the message is redacted anyway.
    console.error("[app] root layout failed", error.digest ?? error.name);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <style>{PAGE_CSS}</style>
        <main>
          <h1>TwinLLM couldn&rsquo;t load</h1>
          <p>
            The problem is on our side. It is usually short-lived: reload the page to try
            again.
          </p>
          <button type="button" onClick={reset}>
            Reload
          </button>
        </main>
      </body>
    </html>
  );
};

export default GlobalError;
