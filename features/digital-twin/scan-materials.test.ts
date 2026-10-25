import { describe, expect, test } from "bun:test";
import {
  BoxGeometry,
  ClampToEdgeWrapping,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from "three";

import {
  initialAutoRotate,
  prepareScanMaterials,
  prepareScanTextures,
  SCAN_ROUGHNESS,
  scanTextureCap,
  type ScanImage,
  type ScanTextureDeps,
} from "./scan-materials";

/** A BodyLoop-like texture: `side`² with the file's nearest sampler, no real pixels. */
const scanTexture = (side = 8192): Texture => {
  const texture = new Texture({ width: side, height: side });
  Object.assign(texture, {
    name: "scan-albedo",
    magFilter: NearestFilter,
    minFilter: NearestFilter,
    generateMipmaps: false,
    flipY: false,
    wrapS: RepeatWrapping,
    wrapT: ClampToEdgeWrapping,
    colorSpace: SRGBColorSpace,
  });
  return texture;
};

const sceneWith = (...materials: Material[]): Group => {
  const root = new Group();
  for (const material of materials) {
    root.add(new Mesh(new BoxGeometry(0.1, 0.1, 0.1), material));
  }
  return root;
};

type Log = { resized: (readonly [number, number, number])[]; events: string[] };

const recordingDeps = (
  overrides: Partial<ScanTextureDeps> = {},
): { deps: ScanTextureDeps; log: Log } => {
  const log: Log = { resized: [], events: [] };
  const deps: ScanTextureDeps = {
    maxAnisotropy: 16,
    deviceMemoryGb: undefined,
    resize: (image: ScanImage, width: number, height: number): ScanImage => {
      log.resized.push([image.width, width, height]);
      return { width, height };
    },
    release: (image: ScanImage) => {
      log.events.push(`release ${image.width}`);
    },
    ...overrides,
  };
  return { deps, log };
};

const onDispose = (texture: Texture, log: Log, name: string): void => {
  texture.addEventListener("dispose", () => log.events.push(`dispose ${name}`));
};

describe("scan materials", () => {
  test("forces metalness 0 and sRGB color space when the glb has no metal map", () => {
    const map = new Texture();
    const material = new MeshStandardMaterial({
      metalness: 1,
      roughness: 0.2,
      map,
    });
    const mesh = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), material);
    const root = new Group();
    root.add(mesh);
    const diags = prepareScanMaterials(root);
    expect(material.metalness).toBe(0);
    expect(material.roughness).toBe(SCAN_ROUGHNESS);
    expect(material.map?.colorSpace).toBe(SRGBColorSpace);
    expect(diags[0]?.type).toBe("MeshStandardMaterial");
    expect(diags[0]?.metalness).toBe(0);
    expect(diags[0]?.mapColorSpace).toBe(SRGBColorSpace);
  });

  test("reduced-motion disables auto-rotate by default", () => {
    expect(initialAutoRotate(true)).toBe(false);
    expect(initialAutoRotate(false)).toBe(true);
  });
});

describe("scan textures", () => {
  test("cap is 4096 unless the browser reports less than 8 GB", () => {
    expect(scanTextureCap(undefined)).toBe(4096);
    expect(scanTextureCap(8)).toBe(4096);
    expect(scanTextureCap(16)).toBe(4096);
    expect(scanTextureCap(4)).toBe(2048);
    expect(scanTextureCap(2)).toBe(2048);
  });

  test("an 8K texture becomes a 4096 copy with linear mipmapped sampling", () => {
    const original = scanTexture();
    const material = new MeshStandardMaterial({ map: original });
    const { deps, log } = recordingDeps();
    onDispose(original, log, "original");
    prepareScanTextures(sceneWith(material), deps);

    const next = material.map;
    expect(next).not.toBe(original);
    expect(log.resized).toEqual([[8192, 4096, 4096]]);
    expect(log.events).toEqual(["dispose original", "release 8192"]);
    expect(next?.image).toEqual({ width: 4096, height: 4096 });
    expect(next?.magFilter).toBe(LinearFilter);
    expect(next?.minFilter).toBe(LinearMipmapLinearFilter);
    expect(next?.generateMipmaps).toBe(true);
    expect(next?.anisotropy).toBe(8);
    expect(next?.name).toBe("scan-albedo");
    expect(next?.flipY).toBe(false);
    expect(next?.wrapS).toBe(RepeatWrapping);
    expect(next?.wrapT).toBe(ClampToEdgeWrapping);
    expect(next?.colorSpace).toBe(SRGBColorSpace);
  });

  test("clones sharing one source (as GLTFLoader makes them) resize once and keep their transforms", () => {
    const first = scanTexture();
    const second = first.clone();
    second.offset.set(0.5, 0.25);
    second.repeat.set(2, 2);
    second.rotation = 0.3;
    second.center.set(0.5, 0.5);
    second.userData = { channelOf: "occlusion" };
    expect(second.source).toBe(first.source);
    const a = new MeshStandardMaterial({ map: first });
    const b = new MeshStandardMaterial({ map: second, aoMap: second });
    const { deps, log } = recordingDeps();
    onDispose(first, log, "first");
    onDispose(second, log, "second");

    prepareScanTextures(sceneWith(a, b), deps);

    expect(log.resized).toEqual([[8192, 4096, 4096]]);
    // originals go only after every slot is swapped, the image last and once
    expect(log.events).toEqual(["dispose first", "dispose second", "release 8192"]);
    expect(a.map).not.toBe(first);
    expect(b.map).not.toBe(second);
    expect(b.aoMap).toBe(b.map);
    expect(a.map?.source).toBe(b.map?.source);
    expect(b.map?.image).toEqual({ width: 4096, height: 4096 });
    expect(b.map?.offset.toArray()).toEqual([0.5, 0.25]);
    expect(b.map?.repeat.toArray()).toEqual([2, 2]);
    expect(b.map?.rotation).toBe(0.3);
    expect(b.map?.center.toArray()).toEqual([0.5, 0.5]);
    expect(b.map?.userData).toEqual({ channelOf: "occlusion" });
    expect(a.map?.offset.toArray()).toEqual([0, 0]);
  });

  test("low reported memory caps at 2048; non-square keeps its aspect", () => {
    const material = new MeshStandardMaterial({
      map: new Texture({ width: 8192, height: 4096 }),
    });
    const { deps, log } = recordingDeps({ deviceMemoryGb: 4 });
    prepareScanTextures(sceneWith(material), deps);
    expect(log.resized).toEqual([[8192, 2048, 1024]]);
    expect(material.map?.image).toEqual({ width: 2048, height: 1024 });
  });

  test("a texture within the cap is kept and only resampled; anisotropy follows the GPU", () => {
    const small = scanTexture(2048);
    const material = new MeshStandardMaterial({
      map: small,
      normalMap: scanTexture(1024),
    });
    const { deps, log } = recordingDeps({ maxAnisotropy: 4 });
    onDispose(small, log, "small");
    prepareScanTextures(sceneWith(material), deps);
    expect(material.map).toBe(small);
    expect(log.resized).toEqual([]);
    expect(log.events).toEqual([]);
    expect(small.magFilter).toBe(LinearFilter);
    expect(small.minFilter).toBe(LinearMipmapLinearFilter);
    expect(small.generateMipmaps).toBe(true);
    expect(small.anisotropy).toBe(4);
    expect(material.normalMap?.minFilter).toBe(LinearMipmapLinearFilter);
  });

  test("a failed resize keeps the original with the new sampler and frees nothing", () => {
    const original = scanTexture();
    const material = new MeshStandardMaterial({ map: original });
    const { deps, log } = recordingDeps({
      resize: () => {
        throw new Error("no 2D context");
      },
    });
    onDispose(original, log, "original");
    expect(() => prepareScanTextures(sceneWith(material), deps)).not.toThrow();
    expect(material.map).toBe(original);
    expect(original.image).toEqual({ width: 8192, height: 8192 });
    expect(original.magFilter).toBe(LinearFilter);
    expect(original.minFilter).toBe(LinearMipmapLinearFilter);
    expect(log.events).toEqual([]);
  });
});
