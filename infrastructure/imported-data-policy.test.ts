import { describe, expect, test } from "bun:test";

import {
  type ImportedDataRequest,
  LLM_PROVIDERS,
  permitImportedDataRequest,
  permitImportedDataStore,
  permitProviderForRequest,
  PROVIDER_NOT_PERMITTED_ERROR,
  type ProviderRequest,
} from "./data-mode-policy";

const LOCAL: ImportedDataRequest = {
  mode: "personal",
  chatProvider: "ollama",
  chatOnLoopback: true,
};

const refusal = (reason: string) => ({
  ok: false,
  code: "IMPORTED_DATA_NOT_PERMITTED",
  reason,
});

const NOT_PERMITTED = {
  ok: false,
  code: "PROVIDER_NOT_PERMITTED_FOR_DATA_MODE",
  error: PROVIDER_NOT_PERMITTED_ERROR,
};

describe("permitImportedDataStore", () => {
  test("personal mode may import and store", () => {
    expect(permitImportedDataStore("personal")).toEqual({ ok: true });
  });

  test("synthetic mode refuses", () => {
    expect(permitImportedDataStore("synthetic")).toEqual(
      refusal("data-mode-not-personal"),
    );
  });
});

describe("permitImportedDataRequest", () => {
  test("Ollama on this machine in personal mode may read imported data", () => {
    expect(permitImportedDataRequest(LOCAL)).toEqual({ ok: true });
  });

  test("every hosted provider refuses, the consented Exoscale pilot included", () => {
    const hosted = LLM_PROVIDERS.filter((provider) => provider !== "ollama");
    expect(hosted).toEqual(["exoscale", "openrouter", "remote-gpu", "infomaniak"]);
    for (const chatProvider of hosted) {
      expect(permitImportedDataRequest({ ...LOCAL, chatProvider })).toEqual(
        refusal("chat-model-not-local"),
      );
    }
  });

  test("Ollama on another machine refuses", () => {
    expect(permitImportedDataRequest({ ...LOCAL, chatOnLoopback: false })).toEqual(
      refusal("chat-model-not-local"),
    );
  });

  test("synthetic mode refuses before the provider is looked at", () => {
    expect(permitImportedDataRequest({ ...LOCAL, mode: "synthetic" })).toEqual(
      refusal("data-mode-not-personal"),
    );
  });
});

describe("permitProviderForRequest with imported data", () => {
  const request = (provider: ProviderRequest["provider"]): ProviderRequest => ({
    mode: "personal",
    provider,
    hasWearableNarrative: false,
    exoscalePersonalData: "consented-pilot",
    hasImportedData: true,
  });

  test("only Ollama takes it; Exoscale is refused even under the consented pilot", () => {
    expect(permitProviderForRequest(request("ollama"))).toEqual({ ok: true });
    expect(permitProviderForRequest(request("exoscale"))).toEqual(NOT_PERMITTED);
    expect(permitProviderForRequest(request("openrouter"))).toEqual(NOT_PERMITTED);
    expect(permitProviderForRequest(request("remote-gpu"))).toEqual(NOT_PERMITTED);
    expect(permitProviderForRequest(request("infomaniak"))).toEqual(NOT_PERMITTED);
  });

  test("imported data makes a synthetic-mode request personal, like wearable context", () => {
    expect(
      permitProviderForRequest({ ...request("openrouter"), mode: "synthetic" }),
    ).toEqual(NOT_PERMITTED);
  });

  test("without imported data the consented pilot still takes wearable context", () => {
    expect(
      permitProviderForRequest({ ...request("exoscale"), hasImportedData: false }),
    ).toEqual({ ok: true });
  });
});
