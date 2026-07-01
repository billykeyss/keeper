import { describe, it, expect } from "vitest";
import { checkSpeciesScope } from "../../src/validation/allSpecies";
describe("checkSpeciesScope", () => {
  it("rejects a 'listed' rule with no target species row", () => {
    expect(checkSpeciesScope({ speciesScope: "listed" }, []).ok).toBe(false);
  });
  it("accepts a 'listed' rule that has target rows", () => {
    expect(checkSpeciesScope({ speciesScope: "listed" }, [{ role: "target" }]).ok).toBe(true);
  });
  it("accepts an 'all' rule with no target rows", () => {
    expect(checkSpeciesScope({ speciesScope: "all" }, []).ok).toBe(true);
  });
});
