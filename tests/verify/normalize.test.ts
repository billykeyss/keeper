import { describe, expect, test } from "vitest";
import { normalize } from "../../src/verify/normalize";

describe("normalize", () => {
  test("lowercases and collapses runs of whitespace to single spaces", () => {
    expect(normalize("Open   Year\n\tAround")).toBe("open year around");
  });

  test("converts curly quotes and dashes to ASCII", () => {
    expect(normalize("“angler’s” — 5–10 in")).toBe('"angler\'s" - 5-10 in');
  });

  test("rejoins words split by a hyphen at a line break", () => {
    expect(normalize("regu-\nlations apply")).toBe("regulations apply");
  });

  test("applies NFKC so ligatures and full-width forms compare equal", () => {
    expect(normalize("ﬁsh")).toBe(normalize("fish"));
  });

  test("trims leading and trailing whitespace", () => {
    expect(normalize("  daily limit  ")).toBe("daily limit");
  });
});
