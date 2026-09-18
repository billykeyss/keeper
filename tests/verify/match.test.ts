import { describe, expect, test } from "vitest";
import { classifyQuote } from "../../src/verify/match";

describe("classifyQuote", () => {
  test("returns NO_QUOTE when the source has no quotedText", () => {
    expect(classifyQuote(null, "any document text").cls).toBe("NO_QUOTE");
  });

  test("returns EXACT when the quote appears verbatim", () => {
    const doc = "Battle Born Pond. Open year around. Daily: 3 game fish.";
    expect(classifyQuote("Open year around", doc).cls).toBe("EXACT");
  });

  test("returns EXACT despite curly quotes, ligatures and reflowed whitespace", () => {
    const doc = "the angler’s daily limit is 3   “game”\n\tfish";
    expect(classifyQuote('the angler\'s daily limit is 3 "game" fish', doc).cls).toBe("EXACT");
  });

  test("returns MISSING when the quote is absent from the document", () => {
    const doc = "This page is about hunting seasons.";
    expect(classifyQuote("Daily: 3 game fish", doc).cls).toBe("MISSING");
  });

  test("returns MISSING when a number in the quote changed — the regulation-changed signal", () => {
    const doc = "Washoe County ponds. Daily: 5 game fish. Possession: 10 game fish.";
    expect(classifyQuote("Daily: 3 game fish. Possession: 6 game fish.", doc).cls).toBe("MISSING");
  });

  test("returns PARTIAL for a composite table quote whose rows all still appear", () => {
    const quote =
      "Stocking Updates (selected): 1500 Channel Catfish, 05-29-2025; 21 Largemouth Bass, 09-03-2024.";
    const doc = [
      "Stocking Updates",
      "Species        Number   Size    Date",
      "Channel Catfish  1500            05-29-2025",
      "Largemouth Bass    21   12-15 in 09-03-2024",
    ].join("\n");
    expect(classifyQuote(quote, doc).cls).toBe("PARTIAL");
  });

  test("PARTIAL is not returned when a numeric token is missing from the document", () => {
    const quote = "1500 Channel Catfish, 05-29-2025";
    const doc = "Channel Catfish stocked on 05-29-2025. Quantity not recorded.";
    expect(classifyQuote(quote, doc).cls).toBe("MISSING");
  });

  test("reports the closest matching snippet for a MISSING quote", () => {
    const doc = "Washoe County ponds. Daily: 5 game fish. Possession: 10 game fish.";
    const result = classifyQuote("Daily: 3 game fish", doc);
    expect(result.cls).toBe("MISSING");
    expect(result.snippet).toContain("daily: 5 game fish");
  });
});
