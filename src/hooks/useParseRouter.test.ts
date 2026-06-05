import { describe, it, expect } from "vitest";
import {
  buildRouteLabel,
  getReactRouterCandidateFiles,
  parseRoutesFromRouterFile,
  parseRoutesFromRouterFiles,
  parseRoutesFromNextFiles,
  parseRoutesFromAstroFiles,
  parseRoutesFromTanStackStartFiles,
  isTanStackStartAppFile,
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

describe("getReactRouterCandidateFiles", () => {
  it("prioritizes src/App.tsx and includes modular route files", () => {
    const files = [
      "src/main.tsx",
      "src/App.tsx",
      "src/routes/publicRoutes.tsx",
      "src/routes/protectedRoutes.tsx",
      "src/features/orders/orderRoutes.tsx",
      "src/router.tsx",
      "src/pages/Home.tsx",
    ];

    expect(getReactRouterCandidateFiles(files)).toEqual([
      "src/App.tsx",
      "src/routes/publicRoutes.tsx",
      "src/routes/protectedRoutes.tsx",
      "src/features/orders/orderRoutes.tsx",
      "src/router.tsx",
    ]);
  });

  it("falls back to root App.tsx when src/App.tsx is absent", () => {
    const files = ["App.tsx", "routes/publicRoutes.tsx"];

    expect(getReactRouterCandidateFiles(files)).toEqual([
      "App.tsx",
      "routes/publicRoutes.tsx",
    ]);
  });
});

describe("parseRoutesFromRouterFiles", () => {
  it("merges routes across multiple files without duplicates", () => {
    const routes = parseRoutesFromRouterFiles([
      `
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
        </Routes>
      `,
      `
        export function protectedRoutes() {
          return (
            <>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/about" element={<AboutAgain />} />
            </>
          );
        }
      `,
    ]);

    expect(routes.map((route) => route.path)).toEqual([
      "/",
      "/about",
      "/dashboard",
    ]);
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

describe("parseRoutesFromAstroFiles", () => {
  it("should parse static routes from src/pages", () => {
    const files = [
      "astro.config.mjs",
      "src/pages/index.astro",
      "src/pages/about.astro",
      "src/pages/privacy.html",
      "src/pages/blog/index.md",
      "src/pages/docs/getting-started.mdx",
    ];

    const routes = parseRoutesFromAstroFiles(files);
    expect(routes.map((r) => r.path).sort()).toEqual(
      ["/", "/about", "/blog", "/docs/getting-started", "/privacy"].sort(),
    );
  });

  it("should skip dynamic routes and non-page files", () => {
    const files = [
      "src/pages/index.astro",
      "src/pages/posts/[slug].astro",
      "src/pages/api/users.ts",
      "src/pages/api/readme.mdx",
      "src/components/Card.astro",
      "src/pages/_draft.astro",
    ];

    const routes = parseRoutesFromAstroFiles(files);
    expect(routes.map((r) => r.path)).toEqual(["/"]);
  });
});

describe("parseRoutesFromTanStackStartFiles", () => {
  it("should parse static file routes from src/routes", () => {
    const files = [
      "app.config.ts",
      "src/routeTree.gen.ts",
      "src/routes/__root.tsx",
      "src/routes/index.tsx",
      "src/routes/about.tsx",
      "src/routes/dashboard/index.tsx",
      "src/routes/settings.profile.tsx",
    ];

    const routes = parseRoutesFromTanStackStartFiles(files);
    expect(routes.map((r) => r.path).sort()).toEqual(
      ["/", "/about", "/dashboard", "/settings/profile"].sort(),
    );
  });

  it("should skip dynamic and pathless routes", () => {
    const files = [
      "src/routes/__root.tsx",
      "src/routes/index.tsx",
      "src/routes/posts/$postId.tsx",
      "src/routes/_auth.tsx",
      "src/routes/_auth/login.tsx",
      "src/routes/users/route.tsx",
    ];

    const routes = parseRoutesFromTanStackStartFiles(files);
    expect(routes.map((r) => r.path).sort()).toEqual(
      ["/", "/login", "/users"].sort(),
    );
  });

  it("should strip TanStack route module suffixes from flat routes", () => {
    const files = [
      "src/routes/__root.tsx",
      "src/routes/index.lazy.tsx",
      "src/routes/posts.lazy.tsx",
      "src/routes/about.component.tsx",
      "src/routes/settings.profile.loader.tsx",
      "src/routes/users.errorComponent.tsx",
      "src/routes/admin.pendingComponent.tsx",
    ];

    const routes = parseRoutesFromTanStackStartFiles(files);
    expect(routes.map((r) => r.path).sort()).toEqual(
      ["/", "/admin", "/about", "/posts", "/settings/profile", "/users"].sort(),
    );
  });

  it("should preserve literal route segments that match module suffix names", () => {
    const files = [
      "src/routes/__root.tsx",
      "src/routes/component.tsx",
      "src/routes/docs/loader.tsx",
      "src/routes/docs/loader.route.tsx",
    ];

    const routes = parseRoutesFromTanStackStartFiles(files);
    expect(routes.map((r) => r.path).sort()).toEqual(
      ["/component", "/docs/loader"].sort(),
    );
  });

  it("should strip route before module suffixes for directory route files", () => {
    const files = [
      "src/routes/__root.tsx",
      "src/routes/posts/route.tsx",
      "src/routes/posts/route.lazy.tsx",
      "src/routes/users/route.component.tsx",
    ];

    const routes = parseRoutesFromTanStackStartFiles(files);
    expect(routes.map((r) => r.path).sort()).toEqual(
      ["/posts", "/users"].sort(),
    );
  });

  it("should strip non-nested trailing underscores from route segments", () => {
    const files = [
      "src/routes/__root.tsx",
      "src/routes/posts_.new.tsx",
      "src/routes/docs_/guide.tsx",
    ];

    const routes = parseRoutesFromTanStackStartFiles(files);
    expect(routes.map((r) => r.path).sort()).toEqual(
      ["/docs/guide", "/posts/new"].sort(),
    );
  });

  it("should skip route group folders from route paths", () => {
    const files = [
      "src/routes/__root.tsx",
      "src/routes/(marketing)/about.tsx",
      "src/routes/(dashboard)/settings.profile.tsx",
    ];

    const routes = parseRoutesFromTanStackStartFiles(files);
    expect(routes.map((r) => r.path).sort()).toEqual(
      ["/about", "/settings/profile"].sort(),
    );
  });

  it("should exclude dash-prefixed ignored route files and folders", () => {
    const files = [
      "src/routes/__root.tsx",
      "src/routes/about.tsx",
      "src/routes/-components/Button.tsx",
      "src/routes/posts/-helpers.tsx",
      "src/routes/admin.-utils.tsx",
    ];

    const routes = parseRoutesFromTanStackStartFiles(files);
    expect(routes.map((r) => r.path)).toEqual(["/about"]);
  });
});

describe("isTanStackStartAppFile", () => {
  it("detects TanStack Start-specific generated and root route files", () => {
    expect(isTanStackStartAppFile("src/routeTree.gen.ts")).toBe(true);
    expect(isTanStackStartAppFile("src/routeTree.gen.js")).toBe(true);
    expect(isTanStackStartAppFile("src/routes/__root.tsx")).toBe(true);
    expect(isTanStackStartAppFile("src/routes/__root.jsx")).toBe(true);
  });

  it("does not treat generic app config files as TanStack Start signals", () => {
    expect(isTanStackStartAppFile("app.config.ts")).toBe(false);
    expect(isTanStackStartAppFile("app.config.js")).toBe(false);
  });
});
