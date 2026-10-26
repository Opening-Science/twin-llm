/**
 * bun run skills:check — validates every skills/<name>/ folder and runs its
 * eval cases against the scripted model. No network, no real model. Exits 1
 * on any format error or failing case.
 */
import { join } from "node:path";

import { checkSkills, readSyntheticSubjects } from "../../features/skills/read-skills";

const root = process.cwd();
const check = checkSkills(
  join(root, "skills"),
  readSyntheticSubjects(join(root, "evaluation", "questions.v1.json")),
);

check.errors.forEach((error) => console.error(`error  ${error}`));
check.results.forEach((result) => {
  console.log(`${result.passed ? "pass" : "FAIL"}   ${result.skill}/${result.caseId}`);
  if (!result.passed) {
    console.error(`  expected ${JSON.stringify(result.expected)}`);
    console.error(`  actual   ${JSON.stringify(result.actual)}`);
  }
});

const failed = check.results.filter((result) => !result.passed).length;
console.log(
  `${check.skills.length} skills, ${check.results.length} cases, ${failed} failed, ${check.errors.length} format errors`,
);
process.exit(failed > 0 || check.errors.length > 0 ? 1 : 0);
