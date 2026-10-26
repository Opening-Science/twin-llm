import { HomeSkeleton } from "@/features/arena/compare-skeleton";

/**
 * Only the home page lives in this group, so this fallback never wraps
 * `/t/<id>`, whose 404 has to be decided before anything streams (#1).
 */
export default function HomeLoading() {
  return <HomeSkeleton />;
}
