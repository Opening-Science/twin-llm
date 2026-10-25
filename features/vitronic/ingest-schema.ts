import { z } from "zod";

const markerSchema = z.object({
  marker_type: z.string(),
  marker_path: z.string(),
  position: z.tuple([z.number(), z.number(), z.number()]),
  normal: z.tuple([z.number(), z.number(), z.number()]).nullable(),
});

const heightSchema = z.object({
  height_path: z.string(),
  at_marker: z.string(),
  height: z.number(),
  details: z.object({ at_marker: markerSchema }),
});

export const ingestSchema = z
  .object({
    scan_id: z.union([z.string(), z.number()]).optional(),
    viatar: z
      .object({
        viatar_id: z.number().int(),
        proband_id: z.number().int().nullable().optional(),
        key_external: z.string().nullable().optional(),
        meta: z.object({ crtime: z.string().optional() }).nullable().optional(),
      })
      .optional(),
    effectiveDateTime: z.string().optional(),
    height: z.array(heightSchema).optional(),
    distance: z.array(z.unknown()).optional(),
    angle: z.array(z.unknown()).optional(),
    axis: z.unknown().optional(),
    cross_section: z.unknown().optional(),
    marker: z.unknown().optional(),
    properties: z.array(z.unknown()).optional(),
    glbBase64: z.string().min(1).optional(),
  })
  .refine(
    (row) =>
      Boolean(row.glbBase64) ||
      Boolean(row.properties?.length) ||
      Boolean(row.height?.length) ||
      Boolean(row.distance?.length) ||
      Boolean(row.angle?.length) ||
      row.marker !== undefined ||
      row.cross_section !== undefined,
    { message: "glb-or-measurements-required" },
  );

export type IngestBody = z.infer<typeof ingestSchema>;
