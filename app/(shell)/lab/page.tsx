import { LabScreen } from "@/features/lab/lab-screen";
import { loadVerifiability } from "@/features/lab/run-lab-checks";

export default async function LabPage() {
  return <LabScreen sections={[await loadVerifiability()]} />;
}
