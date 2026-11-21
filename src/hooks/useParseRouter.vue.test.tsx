import type { PropsWithChildren } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { useParseRouter } from "./useParseRouter";

const readAppFile = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({
    app: { files: ["src/router/index.ts", "src/views/Home.vue"] },
    loading: false,
    error: null,
    refreshApp: vi.fn(),
  }),
}));
vi.mock("@/ipc/types", () => ({
  ipc: { app: { readAppFile } },
}));

it("loads a Vue router through the file API and offers its routes to the preview", async () => {
  readAppFile.mockResolvedValue(`
    import { createRouter, createWebHistory } from 'vue-router';
    export default createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', component: () => import('../views/Home.vue') },
        { path: '/about', component: () => import('../views/About.vue') },
      ],
    });
  `);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(() => useParseRouter(42), { wrapper });
  try {
    await waitFor(() =>
      expect(result.current.routes).toEqual([
        { path: "/", label: "Home" },
        { path: "/about", label: "About" },
      ]),
    );
    expect(readAppFile).toHaveBeenCalledExactlyOnceWith({
      appId: 42,
      filePath: "src/router/index.ts",
    });
  } finally {
    unmount();
    client.clear();
  }
});
