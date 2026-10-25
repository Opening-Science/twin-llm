import {
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Source,
  SRGBColorSpace,
  type Texture,
} from "three";

export const SCAN_ROUGHNESS = 0.9;

export type MaterialDiag = Readonly<{
  type: string;
  metalness: number;
  roughness: number;
  mapColorSpace: string | null;
}>;

export const prepareScanMaterials = (
  root: Object3D,
  options: { readonly log?: boolean } = {},
): readonly MaterialDiag[] => {
  const diags: MaterialDiag[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial)) {
        diags.push({
          type: material.type,
          metalness: Number.NaN,
          roughness: Number.NaN,
          mapColorSpace: null,
        });
        continue;
      }
      if (material.map) {
        material.map.colorSpace = SRGBColorSpace;
        material.map.needsUpdate = true;
      }
      if (!material.metalnessMap) {
        material.metalness = 0;
        material.roughness = SCAN_ROUGHNESS;
      }
      const diag: MaterialDiag = {
        type: material.type,
        metalness: material.metalness,
        roughness: material.roughness,
        mapColorSpace: material.map ? String(material.map.colorSpace) : null,
      };
      diags.push(diag);
      if (options.log) {
        console.warn("[vitronic] material", diag);
      }
    }
  });
  return diags;
};

/*
 * BodyLoop ships 8192² JPEG textures with a nearest-filter sampler, which
 * GLTFLoader honours: blocky up close, shimmering while rotating, and 256 MiB of
 * GPU memory per texture. Scan textures are capped and resampled when the scan
 * loads, before it joins the scene, so the 8K image is never uploaded.
 */
export const SCAN_TEXTURE_CAP = 4096;
export const SCAN_TEXTURE_CAP_LOW_MEMORY = 2048;
export const SCAN_TEXTURE_MAX_ANISOTROPY = 8;

/**
 * `navigator.deviceMemory` is capped at 8 in Chrome and missing in Safari and
 * Firefox, so only a known value under 8 GB lowers the cap.
 */
export const scanTextureCap = (deviceMemoryGb: number | undefined): number =>
  deviceMemoryGb !== undefined && deviceMemoryGb < 8
    ? SCAN_TEXTURE_CAP_LOW_MEMORY
    : SCAN_TEXTURE_CAP;

export type ScanImage = Readonly<{ width: number; height: number }>;

export type ScanTextureDeps = Readonly<{
  maxAnisotropy: number;
  deviceMemoryGb: number | undefined;
  /** Returns a copy of `image` at `width`×`height`. Injected so tests need no canvas. */
  resize: (image: ScanImage, width: number, height: number) => ScanImage;
  /** Frees a replaced original image, called once per image after every swap. */
  release: (image: ScanImage) => void;
}>;

const TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
] as const;

const isScanImage = (value: unknown): value is ScanImage =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as ScanImage).width === "number" &&
  typeof (value as ScanImage).height === "number";

/** The downscaled source for `source`, or null to keep it (within the cap, or the resize failed). */
const resizeSource = (
  source: Source<unknown>,
  deps: ScanTextureDeps,
): Source<unknown> | null => {
  const image: unknown = source.data;
  const cap = scanTextureCap(deps.deviceMemoryGb);
  if (!isScanImage(image) || Math.max(image.width, image.height) <= cap) return null;
  const ratio = cap / Math.max(image.width, image.height);
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  try {
    return new Source(deps.resize(image, width, height));
  } catch {
    // A failed resize must not lose the scan; the original still renders.
    return null;
  }
};

/** Linear, mipmapped sampling in place of the file's nearest filter. */
const applyScanSampler = (texture: Texture, maxAnisotropy: number): void => {
  // three.js samplers are configured by mutation on the texture object.
  Object.assign(texture, {
    magFilter: LinearFilter,
    minFilter: LinearMipmapLinearFilter,
    generateMipmaps: true,
    anisotropy: Math.min(SCAN_TEXTURE_MAX_ANISOTROPY, Math.max(1, maxAnisotropy)),
    needsUpdate: true,
  });
};

/**
 * Resamples every texture slot of the scan's standard materials. GLTFLoader
 * clones textures that share one image (per material, texCoord or
 * KHR_texture_transform), so resizing is keyed by the image's `Source`: each
 * image is resized once and every clone gets a copy of itself pointing at the
 * smaller source, keeping its offset, repeat, rotation and userData. Originals
 * are disposed and their images released only after the whole traversal, so no
 * texture still being read can lose its image.
 */
export const prepareScanTextures = (root: Object3D, deps: ScanTextureDeps): void => {
  const sources = new Map<Source<unknown>, Source<unknown> | null>();
  const swapped = new Map<Texture, Texture>();
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial)) continue;
      for (const slot of TEXTURE_SLOTS) {
        const texture = material[slot];
        if (!texture) continue;
        let next = swapped.get(texture);
        if (!next) {
          if (!sources.has(texture.source)) {
            sources.set(texture.source, resizeSource(texture.source, deps));
          }
          const smaller = sources.get(texture.source) ?? null;
          next = smaller ? texture.clone() : texture;
          // The clone keeps the loader's settings; only its image changes.
          if (smaller) Object.assign(next, { source: smaller });
          applyScanSampler(next, deps.maxAnisotropy);
          swapped.set(texture, next);
        }
        // Materials are three.js objects configured in place; swap the slot.
        if (next !== texture)
          Object.assign(material, { [slot]: next, needsUpdate: true });
      }
    }
  });
  for (const [original, next] of swapped) {
    if (next !== original) original.dispose();
  }
  for (const [original, smaller] of sources) {
    if (smaller && isScanImage(original.data)) deps.release(original.data);
  }
};

/**
 * Browser resampler for `ScanTextureDeps.resize`. High smoothing quality, so an
 * 8192 → 2048 step does not alias; throws when no 2D context is available.
 */
export const downscaleImage = (
  image: ScanImage,
  width: number,
  height: number,
): ScanImage => {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas context for the texture resize.");
  // Canvas smoothing is a mutable context setting.
  Object.assign(context, { imageSmoothingEnabled: true, imageSmoothingQuality: "high" });
  context.drawImage(image as CanvasImageSource, 0, 0, width, height);
  return canvas;
};

/** Browser `ScanTextureDeps.release`: closes an ImageBitmap so its decoded pixels are freed. */
export const releaseImage = (image: ScanImage): void => {
  if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
};

export const initialAutoRotate = (prefersReducedMotion: boolean): boolean =>
  !prefersReducedMotion;
