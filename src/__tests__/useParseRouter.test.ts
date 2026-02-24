import { describe, it, expect } from "vitest";
import {
  buildRouteLabel,
  parseRoutesFromRouterFile,
  parseRoutesFromNextFiles,
} from "@/hooks/useParseRouter";

describe("buildRouteLabel", () => {
  it("should return 'Home' for root path", () => {
    expect(buildRouteLabel("/")).toBe("Home");
  });

  it("should capitalize the last segment", () => {
    expect(buildRouteLabel("/about")).toBe("About");
    expect(buildRouteLabel("/contact-us")).toBe("Contact us");
    expect(buildRouteLabel("/user_profile")).toBe("User profile");
  });

  it("should skip dynamic segments with colons", () => {
    expect(buildRouteLabel("/users/:id")).toBe("Users");
    expect(buildRouteLabel("/users/:id/posts")).toBe("Posts");
  });

  it("should handle deeply nested paths", () => {
    expect(buildRouteLabel("/admin/settings/security")).toBe("Security");
  });
});

describe("parseRoutesFromRouterFile", () => {
  it("should parse simple routes from JSX", () => {
    const content = `
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
      </Routes>
    `;
    const routes = parseRoutesFromRouterFile(content);
    expect(routes).toHaveLength(3);
    expect(routes.map((r) => r.path)).toEqual(["/", "/about", "/contact"]);
  });

  it("should NOT include wildcard '*' routes - these cause Invalid URL TypeError", () => {
    const content = `
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    `;
    const routes = parseRoutesFromRouterFile(content);
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.path)).toEqual(["/", "/dashboard"]);
    expect(routes.some((r) => r.path === "*")).toBe(false);
  });

  it("should NOT include '/*' wildcard routes", () => {
    const content = `
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/*" element={<CatchAll />} />
      </Routes>
    `;
    const routes = parseRoutesFromRouterFile(content);
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe("/");
    expect(routes.some((r) => r.path === "/*")).toBe(false);
  });

  it("should handle routes with single quotes", () => {
    const content = `
      <Routes>
        <Route path='/' element={<Home />} />
        <Route path='/about' element={<About />} />
        <Route path='*' element={<NotFound />} />
      </Routes>
    `;
    const routes = parseRoutesFromRouterFile(content);
    expect(routes).toHaveLength(2);
    expect(routes.some((r) => r.path === "*")).toBe(false);
  });

  it("should handle path attribute before element", () => {
    // Note: The regex works when path comes before element, or when element doesn't contain >
    const content = `
      <Routes>
        <Route path="/" element={Home} />
        <Route exact path="/users" element={<Users />} />
      </Routes>
    `;
    const routes = parseRoutesFromRouterFile(content);
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.path)).toEqual(["/", "/users"]);
  });

  it("should not include duplicate routes", () => {
    const content = `
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/" element={<AltHome />} />
      </Routes>
    `;
    const routes = parseRoutesFromRouterFile(content);
    expect(routes).toHaveLength(1);
  });

  it("should return empty array for null content", () => {
    const routes = parseRoutesFromRouterFile(null);
    expect(routes).toEqual([]);
  });

  it("should return empty array for content without routes", () => {
    const content = `
      export default function App() {
        return <div>Hello World</div>;
      }
    `;
    const routes = parseRoutesFromRouterFile(content);
    expect(routes).toEqual([]);
  });

  it("should include dynamic routes with params (they are valid navigation targets with placeholders)", () => {
    const content = `
      <Routes>
        <Route path="/users/:id" element={<User />} />
      </Routes>
    `;
    const routes = parseRoutesFromRouterFile(content);
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe("/users/:id");
  });
});

describe("parseRoutesFromNextFiles", () => {
  describe("pages router", () => {
    it("should parse routes from pages directory", () => {
      const files = ["pages/index.tsx", "pages/about.tsx", "pages/contact.tsx"];
      const routes = parseRoutesFromNextFiles(files);
      expect(routes.map((r) => r.path).sort()).toEqual(
        ["/", "/about", "/contact"].sort(),
      );
    });

    it("should skip API routes", () => {
      const files = [
        "pages/index.tsx",
        "pages/api/users.ts",
        "pages/api/posts.ts",
      ];
      const routes = parseRoutesFromNextFiles(files);
      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe("/");
    });

    it("should skip special files", () => {
      const files = [
        "pages/index.tsx",
        "pages/_app.tsx",
        "pages/_document.tsx",
        "pages/_error.tsx",
      ];
      const routes = parseRoutesFromNextFiles(files);
      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe("/");
    });

    it("should skip dynamic routes", () => {
      const files = [
        "pages/index.tsx",
        "pages/users/[id].tsx",
        "pages/posts/[...slug].tsx",
      ];
      const routes = parseRoutesFromNextFiles(files);
      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe("/");
    });

    it("should handle nested index files", () => {
      const files = ["pages/blog/index.tsx"];
      const routes = parseRoutesFromNextFiles(files);
      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe("/blog");
    });
  });

  describe("app router", () => {
    it("should parse routes from app directory", () => {
      const files = [
        "app/page.tsx",
        "app/about/page.tsx",
        "app/contact/page.tsx",
      ];
      const routes = parseRoutesFromNextFiles(files);
      expect(routes.map((r) => r.path).sort()).toEqual(
        ["/", "/about", "/contact"].sort(),
      );
    });

    it("should handle src/app directory", () => {
      const files = ["src/app/page.tsx", "src/app/dashboard/page.tsx"];
      const routes = parseRoutesFromNextFiles(files);
      expect(routes.map((r) => r.path).sort()).toEqual(
        ["/", "/dashboard"].sort(),
      );
    });

    it("should skip dynamic segments in app router", () => {
      const files = ["app/page.tsx", "app/users/[id]/page.tsx"];
      const routes = parseRoutesFromNextFiles(files);
      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe("/");
    });

    it("should handle route groups (ignore parentheses)", () => {
      const files = [
        "app/(marketing)/about/page.tsx",
        "app/(dashboard)/settings/page.tsx",
      ];
      const routes = parseRoutesFromNextFiles(files);
      expect(routes.map((r) => r.path).sort()).toEqual(
        ["/about", "/settings"].sort(),
      );
    });
  });
});
