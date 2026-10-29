/**
 * Links inside the generator. On its own host the generator is `/` and its
 * docs `/docs`; inside the TwinLLM app they are `/synthea` and `/synthea/docs`.
 *
 * `proxy.ts` marks requests it answers for the generator's host with
 * `SYNTHEA_HOST_HEADER`, because after its rewrite the page no longer sees the
 * original Host header. The mark only chooses these links; a forged one on
 * another host gives that client links that 404, nothing more.
 */
export const SYNTHEA_HOST_HEADER = "x-twinllm-synthea-host";

export type SyntheaPaths = Readonly<{ home: string; docs: string }>;

export const syntheaPaths = (onGeneratorHost: boolean): SyntheaPaths =>
  onGeneratorHost
    ? { home: "/", docs: "/docs" }
    : { home: "/synthea", docs: "/synthea/docs" };
