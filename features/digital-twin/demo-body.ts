import { Group, type Mesh, type Object3D, type SkinnedMesh } from "three";

import { atlasToScanRotation } from "@/packages/anatomy/fit";

import { prepareScanMaterials } from "./scan-materials";

export const DEMO_BODY_NODE = "DemoBody";

const isMesh = (object: Object3D): object is Mesh => (object as Mesh).isMesh === true;

const isSkinnedMesh = (object: Object3D): object is SkinnedMesh =>
  (object as SkinnedMesh).isSkinnedMesh === true;

/**
 * Turns a loaded ANNY demo body into something the viewer treats like a scan.
 *
 * The files ship without normals (the glass fade's rim needs them) and without
 * a material, so GLTFLoader's default is metallic; the scan material pass makes
 * it matte. The body is stored in the atlas frame (+Y up, faces +Z), so it is
 * wrapped in the same Rx(+90°) the atlases use to reach the scan frame (+Z up,
 * faces -Y). After that the camera fit, the glass fade and `fitAtlasToScan` run
 * unchanged; with no skeleton the fit falls back to the bounding-box anchor.
 */
export const prepareDemoBody = (scene: Object3D): Group => {
  scene.traverse((object) => {
    if (isMesh(object) && !object.geometry.getAttribute("normal")) {
      object.geometry.computeVertexNormals();
    }
  });
  prepareScanMaterials(scene);
  const wrapper = new Group();
  wrapper.name = DEMO_BODY_NODE;
  wrapper.applyMatrix4(atlasToScanRotation());
  wrapper.add(scene);
  wrapper.updateMatrixWorld(true);
  // A skinned mesh keeps the first box it computes. Taking it here, in the
  // bind pose, keeps the camera fit and the atlas fit the same whatever stance
  // or clip frame the body is in when they read it.
  wrapper.traverse((object) => {
    if (isSkinnedMesh(object)) object.computeBoundingBox();
  });
  return wrapper;
};
