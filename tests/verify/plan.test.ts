import { describe, expect, test } from "vitest";
import { planFetches } from "../../src/verify/plan";
import type { SourceEntry } from "../../src/verify/load";

const entry = (key: string, url: string): SourceEntry => ({
  file: "data/corridor/x.json", waterName: "X", key, url, title: "t",
  documentType: "pdf", instrumentType: "commission_reg", authorityLevel: "primary_regulatory",
  authorityKey: "ndow", retrievedDate: "2026-07-01", quotedText: "q",
  role: "primary", citations: [],
});

describe("planFetches", () => {
  test("fetches each unique URL once even when many sources cite it", () => {
    const plan = planFetches([
      entry("a", "https://ndow.org/cr.pdf"),
      entry("b", "https://ndow.org/cr.pdf"),
      entry("c", "https://ndow.org/other.pdf"),
    ], {});
    expect(plan.urls).toHaveLength(2);
  });

  test("groups urls by host so each host can be fetched serially", () => {
    const plan = planFetches([
      entry("a", "https://ndow.org/1.pdf"),
      entry("b", "https://wildlife.ca.gov/2.pdf"),
      entry("c", "https://ndow.org/3.pdf"),
    ], {});
    expect(plan.byHost.get("ndow.org")).toHaveLength(2);
    expect(plan.byHost.get("wildlife.ca.gov")).toHaveLength(1);
  });

  test("--host narrows the run to one host", () => {
    const plan = planFetches([
      entry("a", "https://ndow.org/1.pdf"),
      entry("b", "https://wildlife.ca.gov/2.pdf"),
    ], { host: "ndow.org" });
    expect(plan.urls).toEqual(["https://ndow.org/1.pdf"]);
  });

  test("--limit caps how many urls are fetched", () => {
    const plan = planFetches([
      entry("a", "https://ndow.org/1.pdf"),
      entry("b", "https://ndow.org/2.pdf"),
      entry("c", "https://ndow.org/3.pdf"),
    ], { limit: 2 });
    expect(plan.urls).toHaveLength(2);
  });

  test("maps each url back to every source entry citing it", () => {
    const plan = planFetches([
      entry("a", "https://ndow.org/cr.pdf"),
      entry("b", "https://ndow.org/cr.pdf"),
    ], {});
    expect(plan.entriesByUrl.get("https://ndow.org/cr.pdf")?.map((e) => e.key)).toEqual(["a", "b"]);
  });
});
