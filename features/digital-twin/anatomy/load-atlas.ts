import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";

/**
 * Loads an atlas GLB. The atlases are meshopt-compressed; three ships the
 * decoder, so it is imported on demand and only when someone first slides past
 * the scan. No new dependency, nothing loaded on a plain page view.
 */
export const loadAtlasGltf = async (
  url: string,
  onProgress: (fraction: number | null) => void,
): Promise<GLTF> => {
  const { MeshoptDecoder } =
    await import("three/examples/jsm/libs/meshopt_decoder.module.js");
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise<GLTF>((resolve, reject) => {
    loader.load(
      url,
      resolve,
      (event) => onProgress(event.lengthComputable ? event.loaded / event.total : null),
      reject,
    );
  });
};
