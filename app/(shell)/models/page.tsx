import { CatalogScreen } from "@/features/models/catalog-screen";
import { serverEnv } from "@/infrastructure/env";
import { fetchActiveModelCatalog } from "@/infrastructure/fetch-model-catalog";
import { defaultModelSelection } from "@/infrastructure/model-catalog";

export default async function ModelsPage() {
  const catalog = await fetchActiveModelCatalog();
  return (
    <CatalogScreen
      catalog={catalog}
      defaultModelIds={catalog ? defaultModelSelection(catalog) : []}
      provider={serverEnv().LLM_PROVIDER}
    />
  );
}
