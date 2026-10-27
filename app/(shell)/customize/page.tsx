import { SkillGrid } from "@/features/customize/skill-cards";
import { runnableSkills } from "@/features/skills/load-skills";

/** Customize · Skills: your own skills (next), and the ones TwinLLM ships. */
export default function CustomizeSkillsPage() {
  const shipped = runnableSkills();
  return (
    <>
      <section aria-labelledby="your-skills">
        <h2 id="your-skills" className="text-lg">
          Yours
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Skills you make: name it, say what it should do, pick what it may read and which
          tools it may call. Coming in the next change.
        </p>
      </section>
      <section aria-labelledby="shipped-skills" className="mt-10">
        <h2 id="shipped-skills" className="text-lg">
          Discover
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Skills that come with TwinLLM. Each passed its checks before it is listed here.
        </p>
        <SkillGrid skills={shipped} />
      </section>
    </>
  );
}
