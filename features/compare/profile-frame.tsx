import {
  frameSourceLine,
  type GbdProfileFrame,
} from "@/infrastructure/gbd-profile-frame";

/**
 * The app's own frame around a population profile answer (SPEC 5.6): the
 * profile title and its source above the narration, the attribution and the
 * citation below it.
 */

export const ProfileHeader = ({ frame }: Readonly<{ frame: GbdProfileFrame }>) => (
  <header className="compare-profile-header">
    <h4 className="text-sm font-medium">{frame.title}</h4>
    <p className="text-eyebrow">{frameSourceLine(frame)}</p>
  </header>
);

export const ProfileFooter = ({ frame }: Readonly<{ frame: GbdProfileFrame }>) => (
  <footer className="compare-profile-footer">
    <p>{frame.attribution}</p>
    <p>
      <span className="font-medium">Citation</span> {frame.citation}
    </p>
  </footer>
);
