import { SkillForm } from "@/features/skills/skill-form";

export default function NewSkillPage() {
  return (
    <section aria-labelledby="new-skill">
      <h2 id="new-skill" className="text-lg">
        New skill
      </h2>
      <p className="text-muted-foreground mt-1 mb-6 max-w-2xl text-sm">
        A skill is a saved way of asking: instructions plus the sources and tools it may
        use. It can only narrow what a chat already allows.
      </p>
      <SkillForm />
    </section>
  );
}
