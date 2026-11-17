import { ModelsScreen } from "@/features/models-screen/models-screen";
import { serverEnv } from "@/infrastructure/env";
import {
  fetchActiveModelCatalog,
  isFallbackCatalog,
} from "@/infrastructure/fetch-model-catalog";
import { defaultModelSelection } from "@/infrastructure/model-catalog";

/** The provider is asked on every request; nothing personal is read. */
export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  const env = serverEnv();
  const models = await fetchActiveModelCatalog();
  return (
    <ModelsScreen
      models={models}
      offline={models !== null && isFallbackCatalog(models)}
      defaults={models === null ? [] : defaultModelSelection(models)}
      provider={env.LLM_PROVIDER}
    />
  );
}
