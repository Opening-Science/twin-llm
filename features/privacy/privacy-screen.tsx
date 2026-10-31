import { ConsentCard } from "./consent-card";
import { type ScopeView, SOURCE_CHOICES } from "./privacy-view";

/**
 * Customize · Privacy (#145, docs/privacy-design.md 2.4): "Learning from your
 * data". Off by default, one card per use, and what withdrawing does and
 * does not undo.
 */
export const PrivacyScreen = ({
  mode,
  signedIn,
  views,
}: Readonly<{
  mode: "synthetic" | "personal";
  signedIn: boolean;
  views: readonly ScopeView[];
}>) => (
  <section aria-labelledby="learning-heading">
    <h2 id="learning-heading" className="text-lg">
      Learning from your data
    </h2>
    <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
      TwinLLM&rsquo;s training, answer-key and evaluation pipelines may read your own data
      only with your consent, given here for each use. Every use is off until you turn it
      on. Removing names or dates does not replace consent. Synthetic cohorts never need
      it.
    </p>
    <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
      Your own use needs no consent: chatting, saving a twin note with{" "}
      <span className="font-mono">/compact</span>, searching your threads and exporting a
      thread.
    </p>
    {mode === "synthetic" ? (
      <p className="mt-4 text-sm">
        This install holds synthetic data only, so there is nothing to consent to.
      </p>
    ) : !signedIn ? (
      <p className="text-muted-foreground mt-4 text-sm">Sign in to manage consent.</p>
    ) : (
      <>
        <ul className="mt-4 flex flex-col gap-4">
          {views.map((view) => (
            <ConsentCard key={view.scope} view={view} choices={SOURCE_CHOICES} />
          ))}
        </ul>
        <div className="mt-6 max-w-2xl text-sm">
          <h3 className="font-medium">What withdrawing does</h3>
          <p className="text-muted-foreground mt-1">
            It stops every future run from reading your data for that use, from the moment
            you press Withdraw. Each run checks before it reads and again before it
            writes.
          </p>
          <h3 className="mt-3 font-medium">What it does not undo</h3>
          <p className="text-muted-foreground mt-1">
            A model already trained on your data cannot unlearn it. Sets, keys and scores
            made while the consent held stay where they were written until you delete
            them; each names the consents it relied on in its manifest (
            <span className="font-mono">learning_consents</span>), so you can find them.
            The record of your grant and withdrawal stays in the audit chain.
          </p>
        </div>
      </>
    )}
  </section>
);
