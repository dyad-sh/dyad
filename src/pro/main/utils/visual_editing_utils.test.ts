import { describe, it, expect } from "vitest";
import { transformContent, analyzeComponent } from "./visual_editing_utils";

describe("transformContent", () => {
  describe("className manipulation", () => {
    it("should add className attribute when none exists", () => {
      const content = `
function Component() {
  return <div>Hello</div>;
}`;

      const changes = new Map([
        [3, { classes: ["bg-[#ff0000]", "p-[16px]"], prefixes: ["bg-", "p-"] }],
      ]);

      const result = transformContent(content, changes);
      expect(result).toContain('className="bg-[#ff0000] p-[16px]"');
    });

    it("should append classes to existing className", () => {
      const content = `
function Component() {
  return <div className="existing-class">Hello</div>;
}`;

      const changes = new Map([
        [3, { classes: ["bg-[#0000ff]"], prefixes: ["bg-"] }],
      ]);

      const result = transformContent(content, changes);
      expect(result).toContain("existing-class");
      expect(result).toContain("bg-[#0000ff]");
    });

    it("should remove classes with matching prefixes", () => {
      const content = `
function Component() {
  return <div className="bg-[#ff0000] p-[16px] text-[18px]">Hello</div>;
}`;

      const changes = new Map([
        [3, { classes: ["bg-[#0000ff]"], prefixes: ["bg-"] }],
      ]);

      const result = transformContent(content, changes);
      expect(result).not.toContain("bg-[#ff0000]");
      expect(result).toContain("bg-[#0000ff]");
      expect(result).toContain("p-[16px]");
      expect(result).toContain("text-[18px]");
    });

    it("should handle font-weight classes correctly", () => {
      const content = `
function Component() {
  return <div className="font-[600] text-lg">Hello</div>;
}`;

      const changes = new Map([
        [3, { classes: ["font-[700]"], prefixes: ["font-weight-"] }],
      ]);

      const result = transformContent(content, changes);
      expect(result).not.toContain("font-[600]");
      expect(result).toContain("font-[700]");
      expect(result).toContain("text-lg");
    });

    it("should handle font-family classes without removing font-weight", () => {
      const content = `
function Component() {
  return <div className="font-[600] font-[Inter] text-lg">Hello</div>;
}`;

      const changes = new Map([
        [3, { classes: ["font-[Roboto]"], prefixes: ["font-family-"] }],
      ]);

      const result = transformContent(content, changes);
      expect(result).toContain("font-[600]");
      expect(result).not.toContain("font-[Inter]");
      expect(result).toContain("font-[Roboto]");
    });

    it("should handle text-size classes without removing text-color or text-align", () => {
      const content = `
function Component() {
  return <div className="text-[18px] text-[center] text-[#ff0000]">Hello</div>;
}`;

      const changes = new Map([
        [3, { classes: ["text-[24px]"], prefixes: ["text-size-"] }],
      ]);

      const result = transformContent(content, changes);
      expect(result).not.toContain("text-[18px]");
      expect(result).toContain("text-[24px]");
      expect(result).toContain("text-[center]");
      expect(result).toContain("text-[#ff0000]");
    });

    it("should handle arbitrary text-size values", () => {
      const content = `
function Component() {
  return <div className="text-[44px] text-center">Hello</div>;
}`;

      const changes = new Map([
        [3, { classes: ["text-[32px]"], prefixes: ["text-size-"] }],
      ]);

      const result = transformContent(content, changes);
      expect(result).not.toContain("text-[44px]");
      expect(result).toContain("text-[32px]");
      expect(result).toContain("text-center");
    });

    it("should remove mt-, mb-, my- when applying my- prefix", () => {
      const content = `
function Component() {
  return <div className="mt-[16px] mb-[8px] mx-[24px]">Hello</div>;
}`;

      const changes = new Map([
        [3, { classes: ["my-[20px]"], prefixes: ["my-"] }],
      ]);

      const result = transformContent(content, changes);
      expect(result).not.toContain("mt-[16px]");
      expect(result).not.toContain("mb-[8px]");
      expect(result).toContain("my-[20px]");
      expect(result).toContain("mx-[24px]");
    });

    it("should remove ml-, mr-, mx- when applying mx- prefix", () => {
      const content = `
function Component() {
  return <div className="ml-[16px] mr-[8px] my-[24px]">Hello</div>;
}`;

      const changes = new Map([
        [3, { classes: ["mx-[20px]"], prefixes: ["mx-"] }],
      ]);

      const result = transformContent(content, changes);
      expect(result).not.toContain("ml-[16px]");
      expect(result).not.toContain("mr-[8px]");
      expect(result).toContain("mx-[20px]");
      expect(result).toContain("my-[24px]");
    });

    it("should handle padding classes similarly to margin", () => {
      const content = `
function Component() {
  return <div className="pt-[16px] pb-[8px] px-[24px]">Hello</div>;
}`;

      const changes = new Map([
        [3, { classes: ["py-[20px]"], prefixes: ["py-"] }],
      ]);

      const result = transformContent(content, changes);
      expect(result).not.toContain("pt-[16px]");
      expect(result).not.toContain("pb-[8px]");
      expect(result).toContain("py-[20px]");
      expect(result).toContain("px-[24px]");
    });
  });

  describe("text content manipulation", () => {
    it("should update text content for elements with only text", () => {
      const content = `
function Component() {
  return <div>Old text</div>;
}`;

      const changes = new Map([
        [
          3,
          {
            classes: [],
            prefixes: [],
            textContent: "New text",
          },
        ],
      ]);

      const result = transformContent(content, changes);
      expect(result).not.toContain("Old text");
      expect(result).toContain("New text");
    });

    it("should not update text content when element has nested JSX", () => {
      const content = `
function Component() {
  return <div>Old text <span>nested</span></div>;
}`;

      const changes = new Map([
        [
          3,
          {
            classes: [],
            prefixes: [],
            textContent: "New text",
          },
        ],
      ]);

      const result = transformContent(content, changes);
      expect(result).toContain("Old text");
      expect(result).toContain("<span>nested</span>");
    });

    it("should update text content and classes together", () => {
      const content = `
function Component() {
  return <div className="text-[18px]">Old text</div>;
}`;

      const changes = new Map([
        [
          3,
          {
            classes: ["text-[24px]"],
            prefixes: ["text-size-"],
            textContent: "New text",
          },
        ],
      ]);

      const result = transformContent(content, changes);
      expect(result).toContain("text-[24px]");
      expect(result).not.toContain("text-[18px]");
      expect(result).toContain("New text");
      expect(result).not.toContain("Old text");
    });
  });

  describe("spacing edge cases", () => {
    it("should split m-[] into my-[] when adding mx-[]", () => {
      const content = `
function Component() {
  return <div className="m-[20px]">Content</div>;
}`;

      const changes = new Map([
        [
          3,
          {
            classes: ["mx-[10px]"],
            prefixes: ["mx-"],
          },
        ],
      ]);

      const result = transformContent(content, changes);
      expect(result).not.toContain("m-[20px]");
      expect(result).toContain("my-[20px]");
      expect(result).toContain("mx-[10px]");
    });

    it("should split m-[] into mx-[] when adding my-[]", () => {
      const content = `
function Component() {
  return <div className="m-[20px]">Content</div>;
}`;

      const changes = new Map([
        [
          3,
          {
            classes: ["my-[10px]"],
            prefixes: ["my-"],
          },
        ],
      ]);

      const result = transformContent(content, changes);
      expect(result).not.toContain("m-[20px]");
      expect(result).toContain("mx-[20px]");
      expect(result).toContain("my-[10px]");
    });

    it("should split p-[] into py-[] when adding px-[]", () => {
      const content = `
function Component() {
  return <div className="p-[16px]">Content</div>;
}`;

      const changes = new Map([
        [
          3,
          {
            classes: ["px-[8px]"],
            prefixes: ["px-"],
          },
        ],
      ]);

      const result = transformContent(content, changes);
      expect(result).not.toContain("p-[16px]");
      expect(result).toContain("py-[16px]");
      expect(result).toContain("px-[8px]");
    });

    it("should split p-[] into px-[] when adding py-[]", () => {
      const content = `
function Component() {
  return <div className="p-[16px]">Content</div>;
}`;

      const changes = new Map([
        [
          3,
          {
            classes: ["py-[8px]"],
            prefixes: ["py-"],
          },
        ],
      ]);

      const result = transformContent(content, changes);
      expect(result).not.toContain("p-[16px]");
      expect(result).toContain("px-[16px]");
      expect(result).toContain("py-[8px]");
    });

    it("should not add complementary class when both directional classes are added", () => {
      const content = `
function Component() {
  return <div className="m-[20px]">Content</div>;
}`;

      const changes = new Map([
        [
          3,
          {
            classes: ["mx-[10px]", "my-[15px]"],
            prefixes: ["mx-", "my-"],
          },
        ],
      ]);

      const result = transformContent(content, changes);
      expect(result).not.toContain("m-[20px]");
      expect(result).toContain("mx-[10px]");
      expect(result).toContain("my-[15px]");
      // Should not have added an extra mx- or my- with the original value
      expect(result.match(/mx-/g)?.length).toBe(1);
      expect(result.match(/my-/g)?.length).toBe(1);
    });
  });

  describe("multiple changes", () => {
    it("should apply changes to multiple lines", () => {
      const content = `
function Component() {
  return (
    <div>
      <h1 className="text-[18px]">Title</h1>
      <p className="text-[14px]">Paragraph</p>
    </div>
  );
}`;

      const changes = new Map([
        [5, { classes: ["text-[32px]"], prefixes: ["text-size-"] }],
        [6, { classes: ["text-[16px]"], prefixes: ["text-size-"] }],
      ]);

      const result = transformContent(content, changes);
      expect(result).toContain("text-[32px]");
      expect(result).not.toContain("text-[18px]");
      expect(result).toContain("text-[16px]");
      expect(result).not.toContain("text-[14px]");
    });
  });

  describe("edge cases", () => {
    it("should handle empty changes map", () => {
      const content = `
function Component() {
  return <div className="text-[18px]">Hello</div>;
}`;

      const changes = new Map();
      const result = transformContent(content, changes);
      expect(result).toContain("text-[18px]");
      expect(result).toContain("Hello");
    });

    it("should preserve code formatting", () => {
      const content = `
function Component() {
  return (
    <div className="text-[18px]">
      Hello
    </div>
  );
}`;

      const changes = new Map([
        [4, { classes: ["text-[24px]"], prefixes: ["text-size-"] }],
      ]);

      const result = transformContent(content, changes);
      expect(result).toContain("text-[24px]");
      // Recast should preserve overall structure
      expect(result).toMatch(/return\s*\(/);
    });
  });
});

describe("analyzeComponent", () => {
  describe("dynamic styling detection", () => {
    it("should detect conditional className", () => {
      const content = `
function Component() {
  return <div className={isActive ? "active" : "inactive"}>Hello</div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.isDynamic).toBe(true);
    });

    it("should detect logical expression className", () => {
      const content = `
function Component() {
  return <div className={isActive && "active"}>Hello</div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.isDynamic).toBe(true);
    });

    it("should detect template literal className", () => {
      const content = `
function Component() {
  return <div className={\`base-class \${dynamicClass}\`}>Hello</div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.isDynamic).toBe(true);
    });

    it("should detect identifier className", () => {
      const content = `
function Component() {
  return <div className={styles.container}>Hello</div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.isDynamic).toBe(true);
    });

    it("should detect function call className", () => {
      const content = `
function Component() {
  return <div className={cn("base", { active: isActive })}>Hello</div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.isDynamic).toBe(true);
    });

    it("should detect dynamic style attribute", () => {
      const content = `
function Component() {
  return <div style={{ color: isActive ? "red" : "blue" }}>Hello</div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.isDynamic).toBe(true);
    });

    it("should not detect static className", () => {
      const content = `
function Component() {
  return <div className="static-class">Hello</div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.isDynamic).toBe(false);
    });

    it("should not detect when no className or style", () => {
      const content = `
function Component() {
  return <div>Hello</div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.isDynamic).toBe(false);
    });
  });

  describe("static text detection", () => {
    it("should detect static text content", () => {
      const content = `
function Component() {
  return <div>Static text content</div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.hasStaticText).toBe(true);
    });

    it("should detect string literal in expression container", () => {
      const content = `
function Component() {
  return <div>{"Static text"}</div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.hasStaticText).toBe(true);
    });

    it("should not detect static text when element has nested JSX", () => {
      const content = `
function Component() {
  return <div>Text <span>nested</span></div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.hasStaticText).toBe(false);
    });

    it("should not detect static text when empty", () => {
      const content = `
function Component() {
  return <div></div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.hasStaticText).toBe(false);
    });

    it("should ignore whitespace-only text", () => {
      const content = `
function Component() {
  return <div>   </div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.hasStaticText).toBe(false);
    });

    it("should not detect static text with dynamic expression", () => {
      const content = `
function Component() {
  return <div>{dynamicText}</div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.hasStaticText).toBe(false);
    });
  });

  describe("combined analysis", () => {
    it("should detect both dynamic styling and static text", () => {
      const content = `
function Component() {
  return <div className={isActive ? "active" : "inactive"}>Static text</div>;
}`;

      const result = analyzeComponent(content, 3);
      expect(result.isDynamic).toBe(true);
      expect(result.hasStaticText).toBe(true);
    });

    it("should return false for both when element not found", () => {
      const content = `
function Component() {
  return <div>Hello</div>;
}`;

      const result = analyzeComponent(content, 999);
      expect(result.isDynamic).toBe(false);
      expect(result.hasStaticText).toBe(false);
    });
  });

  describe("nested elements", () => {
    it("should analyze correct element on specified line", () => {
      const content = `
function Component() {
  return (
    <div className="w-[100px]">
      <span className={dynamicClass}>Inner</span>
    </div>
  );
}`;

      const outerResult = analyzeComponent(content, 4);
      expect(outerResult.isDynamic).toBe(false);
      expect(outerResult.hasStaticText).toBe(false);

      const innerResult = analyzeComponent(content, 5);
      expect(innerResult.isDynamic).toBe(true);
      expect(innerResult.hasStaticText).toBe(true);
    });
  });

  describe("TypeScript support", () => {
    it("should handle TypeScript syntax", () => {
      const content = `
function Component(): JSX.Element {
  const props: Props = { active: true };
  return <div className={props.active ? "active" : "inactive"}>Hello</div>;
}`;

      const result = analyzeComponent(content, 4);
      expect(result.isDynamic).toBe(true);
      expect(result.hasStaticText).toBe(true);
    });
  });
});
