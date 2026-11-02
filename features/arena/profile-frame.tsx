import {
  frameSourceLine,
  type GbdProfileFrame,
} from "@/infrastructure/gbd-profile-frame";

/**
 * A GBD profile's header and footer (#417), drawn by the app above and below
 * the model's narration, so the title, source, attribution and citation are
 * there whatever the model wrote. The exports carry the same lines
 * (`thread-markdown.ts`).
 */

export const ProfileFrameHeader = ({ frame }: { readonly frame: GbdProfileFrame }) => (
  <header className="profile-frame-header">
    <h3 className="text-base font-medium">{frame.title}</h3>
    <p className="text-eyebrow">{frameSourceLine(frame)}</p>
  </header>
);

export const ProfileFrameFooter = ({ frame }: { readonly frame: GbdProfileFrame }) => (
  <footer className="profile-frame-footer">
    <p>{frame.attribution}</p>
    <p>
      <span className="text-eyebrow">Citation</span> {frame.citation}
    </p>
  </footer>
);
