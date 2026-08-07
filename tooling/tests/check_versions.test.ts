import { describe, expect, it } from "vite-plus/test";
import { moonBitReleaseFromCompilerVersion } from "../check_versions.ts";

describe("MoonBit release metadata", () => {
  it("derives the public release from an exact compiler build", () => {
    expect(moonBitReleaseFromCompilerVersion("0.10.6+80dc50f24")).toBe("0.10.6");
    expect(moonBitReleaseFromCompilerVersion("0.10.6")).toBe("0.10.6");
  });

  it("rejects malformed compiler versions", () => {
    expect(moonBitReleaseFromCompilerVersion("v0.10.6+80dc50f24")).toBeUndefined();
    expect(moonBitReleaseFromCompilerVersion("latest")).toBeUndefined();
  });
});
