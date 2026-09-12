import { describe, it, expect } from "vitest";
import { stylesToTailwind, extractClassPrefixes } from "@/utils/style-utils";

describe("convertSpacingToTailwind", () => {
  describe("margin conversion", () => {
    it("should convert equal margins on all sides", () => {
      const result = stylesToTailwind({
        margin: { left: "16px", right: "16px", top: "16px", bottom: "16px" },
      });
      expect(result).toEqual(["m-[16px]"]);
    });

    it("should convert equal horizontal margins", () => {
      const result = stylesToTailwind({
        margin: { left: "16px", right: "16px" },
      });
      expect(result).toEqual(["mx-[16px]"]);
    });

    it("should convert equal vertical margins", () => {
      const result = stylesToTailwind({
        margin: { top: "16px", bottom: "16px" },
      });
      expect(result).toEqual(["my-[16px]"]);
    });
  });

  describe("padding conversion", () => {
    it("should convert equal padding on all sides", () => {
      const result = stylesToTailwind({
        padding: { left: "20px", right: "20px", top: "20px", bottom: "20px" },
      });
      expect(result).toEqual(["p-[20px]"]);
    });

    it("should convert equal horizontal padding", () => {
      const result = stylesToTailwind({
        padding: { left: "12px", right: "12px" },
      });
      expect(result).toEqual(["px-[12px]"]);
    });

    it("should convert equal vertical padding", () => {
      const result = stylesToTailwind({
        padding: { top: "8px", bottom: "8px" },
      });
      expect(result).toEqual(["py-[8px]"]);
    });
  });

  describe("combined margin and padding", () => {
    it("should handle both margin and padding", () => {
      const result = stylesToTailwind({
        margin: { left: "16px", right: "16px" },
        padding: { top: "8px", bottom: "8px" },
      });
      expect(result).toContain("mx-[16px]");
      expect(result).toContain("py-[8px]");
      expect(result).toHaveLength(2);
    });
  });

  describe("edge cases: equal horizontal and vertical spacing", () => {
    it("should consolidate px = py to p when values match", () => {
      const result = stylesToTailwind({
        padding: { left: "16px", right: "16px", top: "16px", bottom: "16px" },
      });
      // When all four sides are equal, should use p-[]
      expect(result).toEqual(["p-[16px]"]);
    });

    it("should consolidate mx = my to m when values match (but not all four sides)", () => {
      const result = stylesToTailwind({
        margin: { left: "20px", right: "20px", top: "20px", bottom: "20px" },
      });
      // When all four sides are equal, should use m-[]
      expect(result).toEqual(["m-[20px]"]);
    });

    it("should not consolidate when px != py", () => {
      const result = stylesToTailwind({
        padding: { left: "16px", right: "16px", top: "8px", bottom: "8px" },
      });
      expect(result).toContain("px-[16px]");
      expect(result).toContain("py-[8px]");
      expect(result).toHaveLength(2);
    });

    it("should not consolidate when mx != my", () => {
      const result = stylesToTailwind({
        margin: { left: "20px", right: "20px", top: "10px", bottom: "10px" },
      });
      expect(result).toContain("mx-[20px]");
      expect(result).toContain("my-[10px]");
      expect(result).toHaveLength(2);
    });

    it("should handle case where left != right", () => {
      const result = stylesToTailwind({
        padding: { left: "16px", right: "12px", top: "8px", bottom: "8px" },
      });
      expect(result).toContain("pl-[16px]");
      expect(result).toContain("pr-[12px]");
      expect(result).toContain("py-[8px]");
      expect(result).toHaveLength(3);
    });

    it("should handle case where top != bottom", () => {
      const result = stylesToTailwind({
        margin: { left: "20px", right: "20px", top: "10px", bottom: "15px" },
      });
      expect(result).toContain("mx-[20px]");
      expect(result).toContain("mt-[10px]");
      expect(result).toContain("mb-[15px]");
      expect(result).toHaveLength(3);
    });
  });
});

describe("stylesToTailwind - border conversion", () => {
  it("should emit border-[width] and border-[color] for a full border edit", () => {
    const result = stylesToTailwind({
      border: { width: "3px", color: "#ff0000" },
    });
    expect(result).toEqual(["border-[3px]", "border-[#ff0000]"]);
  });

  it("should emit rounded-[radius] separately from border width/color", () => {
    const result = stylesToTailwind({
      border: { width: "2px", radius: "8px", color: "#00ff00" },
    });
    expect(result).toEqual([
      "border-[2px]",
      "rounded-[8px]",
      "border-[#00ff00]",
    ]);
  });

  it("should emit border-[width] alone when only width is set", () => {
    const result = stylesToTailwind({ border: { width: "1rem" } });
    expect(result).toEqual(["border-[1rem]"]);
  });

  it("should emit border-[color] alone when only color is set", () => {
    const result = stylesToTailwind({ border: { color: "#abc123" } });
    expect(result).toEqual(["border-[#abc123]"]);
  });
});

describe("extractClassPrefixes", () => {
  it("should distinguish border-width from border-color for arbitrary values", () => {
    const prefixes = extractClassPrefixes(["border-[3px]", "border-[#ff0000]"]);
    expect(prefixes).toContain("border-width-");
    expect(prefixes).toContain("border-color-");
    expect(prefixes).not.toContain("border-");
    expect(prefixes).toHaveLength(2);
  });

  it("should map various length units to border-width-", () => {
    const prefixes = extractClassPrefixes([
      "border-[2px]",
      "border-[0.5rem]",
      "border-[1.5em]",
      "border-[50%]",
      "border-[0]",
    ]);
    expect(prefixes).toEqual(["border-width-"]);
  });

  it("should map color values (#hex, rgb(), named) to border-color-", () => {
    const prefixes = extractClassPrefixes([
      "border-[#ff0000]",
      "border-[#ff000080]",
      "border-[rgb(255,0,0)]",
    ]);
    expect(prefixes).toEqual(["border-color-"]);
  });

  it("should keep distinct prefixes from a full border edit (real pipeline)", () => {
    const classes = stylesToTailwind({
      border: { width: "3px", color: "#ff0000" },
    });
    expect(extractClassPrefixes(classes)).toEqual([
      "border-width-",
      "border-color-",
    ]);
  });

  it("should return rounded- prefix for rounded utility", () => {
    expect(extractClassPrefixes(["rounded-[8px]"])).toEqual(["rounded-"]);
  });

  it("contrast: font-weight and font-family get distinct prefixes", () => {
    const prefixes = extractClassPrefixes(["font-[700]", "font-[Inter]"]);
    expect(prefixes).toContain("font-weight-");
    expect(prefixes).toContain("font-family-");
    expect(prefixes).toHaveLength(2);
  });

  it("contrast: text-size arbitrary values get text-size- prefix", () => {
    expect(extractClassPrefixes(["text-[44px]"])).toEqual(["text-size-"]);
  });
});
