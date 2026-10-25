import { z } from "zod";

/**
 * BodyLoop 0.13.7 GET /models returns a flat filename → path map, contrary to
 * the OpenAPI `Models` { photogrammetry, dataprocessor } schema.
 */

const pathMapSchema = z.record(z.string().min(1), z.string().min(1));

const groupedSchema = z.object({
  photogrammetry: pathMapSchema.nullable().optional(),
  dataprocessor: pathMapSchema.nullable().optional(),
});

export const GLB_MODEL_PREFERENCE = ["avatar_3d.glb", "mesh_3d.glb", "view.glb"] as const;

export const parseModelsResponse = (body: unknown): Readonly<Record<string, string>> => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const row = body as Record<string, unknown>;
  if ("photogrammetry" in row || "dataprocessor" in row) {
    const parsed = groupedSchema.safeParse(body);
    if (!parsed.success) return {};
    return {
      ...(parsed.data.photogrammetry ?? {}),
      ...(parsed.data.dataprocessor ?? {}),
    };
  }
  const flat = pathMapSchema.safeParse(body);
  if (!flat.success) return {};
  return flat.data;
};

export const modelNamesFromMap = (map: Readonly<Record<string, string>>): readonly string[] =>
  Object.keys(map);

/** Prefer avatar_3d.glb, then mesh_3d.glb, then view.glb. .glb only. */
export const pickGlbModel = (names: readonly string[]): string | null => {
  for (const preferred of GLB_MODEL_PREFERENCE) {
    if (names.includes(preferred)) return preferred;
  }
  return null;
};
