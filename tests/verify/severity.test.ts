import { describe, expect, test } from "vitest";
import { severityFor } from "../../src/verify/severity";

const legal = "commission_reg";

describe("severityFor", () => {
  test("a healthy source has no severity", () => {
    expect(severityFor({ cls: "EXACT", instrumentType: legal, role: "primary" })).toBe("NONE");
    expect(severityFor({ cls: "PARTIAL", instrumentType: legal, role: "primary" })).toBe("NONE");
    expect(severityFor({ cls: "NO_QUOTE", instrumentType: legal, role: "primary" })).toBe("NONE");
  });

  test("MISSING on a primary legal instrument is HIGH", () => {
    expect(severityFor({ cls: "MISSING", instrumentType: legal, role: "primary" })).toBe("HIGH");
  });

  test("UNREACHABLE on a primary legal instrument is HIGH", () => {
    expect(severityFor({ cls: "UNREACHABLE", instrumentType: "statute", role: "primary" })).toBe("HIGH");
  });

  test("MISSING on a corroborating legal instrument is MEDIUM", () => {
    expect(severityFor({ cls: "MISSING", instrumentType: legal, role: "corroborating" })).toBe("MEDIUM");
  });

  test("a webpage source is only ever LOW — stocking pages change weekly by design", () => {
    expect(severityFor({ cls: "MISSING", instrumentType: "webpage", role: "primary" })).toBe("LOW");
    expect(severityFor({ cls: "UNREACHABLE", instrumentType: "webpage", role: "corroborating" })).toBe("LOW");
  });

  test("a third_party mirror never reaches HIGH — a blocked aggregator is not a changed law", () => {
    expect(severityFor({ cls: "UNREACHABLE", instrumentType: "statute", role: "primary",
                         authorityLevel: "third_party" })).toBe("MEDIUM");
    expect(severityFor({ cls: "MISSING", instrumentType: "statute", role: "primary",
                         authorityLevel: "third_party" })).toBe("MEDIUM");
  });

  test("an authoritative source is still HIGH", () => {
    expect(severityFor({ cls: "UNREACHABLE", instrumentType: "statute", role: "primary",
                         authorityLevel: "primary_regulatory" })).toBe("HIGH");
  });

  test("a third_party webpage stays LOW", () => {
    expect(severityFor({ cls: "MISSING", instrumentType: "webpage", role: "primary",
                         authorityLevel: "third_party" })).toBe("LOW");
  });

  test("a legal instrument no regulation cites is MEDIUM, not HIGH", () => {
    expect(severityFor({ cls: "MISSING", instrumentType: "booklet", role: "unreferenced" })).toBe("MEDIUM");
  });
});
