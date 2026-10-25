/**
 * cloud_connect ingest parser. BodyLoop archive bytes are not in the OpenAPI
 * spec — shape pending VUSE XR answer 3.
 */
export const CLOUD_CONNECT_SHAPE_PENDING = "shape pending VUSE XR answer 3";

export const parseCloudConnectExport = (_body: unknown): never => {
  throw new Error(CLOUD_CONNECT_SHAPE_PENDING);
};
