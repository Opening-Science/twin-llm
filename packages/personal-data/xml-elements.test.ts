import { describe, expect, test } from "bun:test";

import {
  createXmlElementScanner,
  decodeXmlText,
  parseXmlAttributes,
  type XmlElement,
} from "./xml-elements";

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!ELEMENT HealthData (Record*)>
<!ATTLIST Record type CDATA #REQUIRED>
]>
<HealthData locale="en_GB">
 <!-- <Record type="in a comment"/> -->
 <Record type="A" value="1" note='x &gt; y'/>
 <Record type="B" value="2" unit="a&amp;b">
  <MetadataEntry key="k" value="v"/>
 </Record>
 <Workout workoutActivityType="Made-up"/>
</HealthData>
`;

const scan = (chunks: readonly string[], names: readonly string[]) => {
  const seen: XmlElement[] = [];
  const scanner = createXmlElementScanner(new Set(names), (element) => {
    seen.push(element);
  });
  chunks.forEach((chunk) => scanner.push(chunk));
  return { seen, ended: scanner.end() };
};

describe("createXmlElementScanner", () => {
  test("hands over the asked-for start tags with decoded attributes", () => {
    expect(scan([DOCUMENT], ["Record", "Workout"])).toEqual({
      seen: [
        { name: "Record", attributes: { type: "A", value: "1", note: "x > y" } },
        { name: "Record", attributes: { type: "B", value: "2", unit: "a&b" } },
        { name: "Workout", attributes: { workoutActivityType: "Made-up" } },
      ],
      ended: true,
    });
  });

  test("gives the same result however the text is split", () => {
    const whole = scan([DOCUMENT], ["Record"]).seen;
    const bySeven = Array.from({ length: Math.ceil(DOCUMENT.length / 7) }, (_, index) =>
      DOCUMENT.slice(index * 7, index * 7 + 7),
    );
    expect(scan(bySeven, ["Record"]).seen).toEqual(whole);
    expect(scan([...DOCUMENT], ["Record"]).seen).toEqual(whole);
  });

  test("a quoted > does not end a tag", () => {
    expect(scan(['<Record value="a>b"/>'], ["Record"]).seen).toEqual([
      { name: "Record", attributes: { value: "a>b" } },
    ]);
  });

  test("reports text that ends inside a tag", () => {
    expect(scan(['<Record type="A"/><Record type='], ["Record"])).toEqual({
      seen: [{ name: "Record", attributes: { type: "A" } }],
      ended: false,
    });
  });

  test("stops when asked", () => {
    const seen: string[] = [];
    const scanner = createXmlElementScanner(new Set(["Record"]), (element) => {
      seen.push(element.attributes.type ?? "");
      return seen.length === 2 ? "stop" : undefined;
    });
    scanner.push('<Record type="1"/><Record type="2"/><Record type="3"/>');
    scanner.push('<Record type="4"/>');
    expect(seen).toEqual(["1", "2"]);
    expect(scanner.end()).toBe(true);
  });
});

describe("decodeXmlText and parseXmlAttributes", () => {
  test("decode the five named entities and character references", () => {
    expect(decodeXmlText("&lt;&gt;&amp;&quot;&apos;&#65;&#x42;")).toBe(`<>&"'AB`);
    expect(decodeXmlText("plain")).toBe("plain");
    expect(decodeXmlText("&unknown;")).toBe("&unknown;");
  });

  test("read single and double quoted attributes", () => {
    expect(parseXmlAttributes(`Record a="1" b='two' c = "3"`)).toEqual({
      a: "1",
      b: "two",
      c: "3",
    });
  });
});
