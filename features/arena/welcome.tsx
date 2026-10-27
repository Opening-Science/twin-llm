import { IncognitoBanner, IncognitoToggle } from "./incognito-controls";

/**
 * The empty new-chat screen: the heading and what TwinLLM does, with the
 * incognito switch at the top right. In incognito mode the banner under the
 * heading says what that means. A saved thread never shows this screen.
 */
export const Welcome = ({
  incognito,
  onToggleIncognito,
}: Readonly<{
  incognito: boolean;
  /** Left out, there is no switch (a saved thread that has no turns yet). */
  onToggleIncognito?: () => void;
}>) => (
  <div className="relative">
    {onToggleIncognito ? (
      <div className="absolute top-0 right-0">
        <IncognitoToggle on={incognito} onToggle={onToggleIncognito} />
      </div>
    ) : null}
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-2 pt-[12vh] text-center">
      <h1 className="text-display">TwinLLM</h1>
      {incognito ? <IncognitoBanner /> : null}
      <p className="text-muted-foreground text-[15px] leading-relaxed">
        Ask a research question, with wearable context if you link a device. Up to three
        open models answer side by side; open any answer to see its reasoning and which
        metrics it cited. Research use and visualisation only.
      </p>
    </div>
  </div>
);
