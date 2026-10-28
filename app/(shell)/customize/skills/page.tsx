import { redirect } from "next/navigation";

/** Skills are the first Customize tab; /customize/skills is a natural guess at its address. */
export default function SkillsIndex() {
  redirect("/customize");
}
