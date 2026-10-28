import { describe, expect, test } from "bun:test";

import { fixture } from "./fixture";
import {
  esearchUrl,
  latestMetadataKey,
  metadataListUrl,
  objectUrl,
  parseEsearchIds,
  parsePmcMetadata,
  pmcArticleUrl,
  s3ToHttps,
} from "./pmc";

describe("esearchUrl", () => {
  test("searches PMC as JSON with the tool name", () => {
    expect(esearchUrl({ term: '"diet"[mesh]', retmax: 9 })).toBe(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=%22diet%22%5Bmesh%5D&retmax=9&retmode=json&tool=twinllm",
    );
  });

  test("adds email only when given", () => {
    expect(esearchUrl({ term: "x", retmax: 1, email: "dev@example.org" })).toBe(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=x&retmax=1&retmode=json&tool=twinllm&email=dev%40example.org",
    );
  });
});

describe("parseEsearchIds", () => {
  test("returns PMCIDs in order", () => {
    expect(parseEsearchIds(fixture("esearch.json"))).toEqual([
      "PMC1000001",
      "PMC1000002",
      "PMC1000003",
    ]);
  });

  test("drops ids that are not numbers", () => {
    expect(parseEsearchIds('{"esearchresult":{"idlist":["12","x1",3]}}')).toEqual([
      "PMC12",
    ]);
  });

  test("throws on a body without an id list", () => {
    expect(() => parseEsearchIds('{"error":"bad"}')).toThrow(
      "LITERATURE_ESEARCH_MALFORMED",
    );
  });
});

describe("bucket listing", () => {
  test("metadataListUrl lists one article's versions", () => {
    expect(metadataListUrl("PMC1000001")).toBe(
      "https://pmc-oa-opendata.s3.amazonaws.com/?list-type=2&prefix=metadata%2FPMC1000001.",
    );
  });

  test("latestMetadataKey picks the newest version", () => {
    expect(latestMetadataKey(fixture("listing.xml"), "PMC1000001")).toBe(
      "metadata/PMC1000001.2.json",
    );
  });

  test("latestMetadataKey ignores other articles and returns null when empty", () => {
    expect(latestMetadataKey(fixture("listing.xml"), "PMC100000")).toBeNull();
    expect(latestMetadataKey("<ListBucketResult/>", "PMC1")).toBeNull();
  });

  test("objectUrl and s3ToHttps build public URLs", () => {
    expect(objectUrl("metadata/PMC1.1.json")).toBe(
      "https://pmc-oa-opendata.s3.amazonaws.com/metadata/PMC1.1.json",
    );
    expect(s3ToHttps("s3://pmc-oa-opendata/PMC1.1/PMC1.1.txt?md5=ab")).toBe(
      "https://pmc-oa-opendata.s3.amazonaws.com/PMC1.1/PMC1.1.txt?md5=ab",
    );
    expect(() => s3ToHttps("s3://other-bucket/x")).toThrow(
      "LITERATURE_S3_URL_UNEXPECTED",
    );
  });

  test("pmcArticleUrl links the article page", () => {
    expect(pmcArticleUrl("PMC1")).toBe("https://pmc.ncbi.nlm.nih.gov/articles/PMC1/");
  });
});

describe("parsePmcMetadata", () => {
  test("reads the fields the fetch needs", () => {
    expect(parsePmcMetadata(fixture("metadata.json"))).toEqual({
      pmcid: "PMC1000001",
      version: 2,
      pmid: 99000001,
      doi: "10.0000/fixture.1",
      title: "Synthetic fibre fixture",
      citation: "Synth Nutr J. 2024 Mar 2;1(1):1-2. doi: 10.0000/fixture.1",
      isOpenAccess: true,
      isManuscript: false,
      isRetracted: false,
      licenceCode: "CC BY",
      textUrl:
        "https://pmc-oa-opendata.s3.amazonaws.com/PMC1000001.2/PMC1000001.2.txt?md5=11",
    });
  });

  test("a missing licence or text stays null", () => {
    const parsed = parsePmcMetadata('{"pmcid":"PMC5","version":1,"license_code":null}');
    expect(parsed.licenceCode).toBeNull();
    expect(parsed.textUrl).toBeNull();
    expect(parsed.title).toBe("PMC5");
    expect(parsed.isOpenAccess).toBe(false);
  });

  test("throws without pmcid or version", () => {
    expect(() => parsePmcMetadata('{"pmcid":"PMC5"}')).toThrow(
      "LITERATURE_METADATA_MALFORMED",
    );
  });
});
