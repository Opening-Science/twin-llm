/**
 * Static helix stand-in. Kept out of the three/fiber module so the Digital
 * Twin screen can render it without pulling WebGL into the main chunk.
 */

export const GenomeHelixFallback = () => (
  <div
    data-helix-fallback
    className="wearables-hero relative flex min-h-[280px] items-center justify-center overflow-hidden rounded-2xl px-5 py-16 text-center"
  >
    <p className="text-eyebrow">Decorative helix</p>
  </div>
);
