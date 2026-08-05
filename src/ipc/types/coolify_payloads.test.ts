import { describe, expect, it } from "vitest";
import { CoolifyServerSchema, CoolifyProjectSchema } from "@/ipc/types/coolify";

describe("real Coolify payloads survive the new validation", () => {
  it("accepts a full 16-field server object", () => {
    const real = {
      id: 0, uuid: "rc7cv7kbvocgj36bjgucsouc", name: "localhost",
      description: "This is the server where Coolify is running on",
      ip: "host.docker.internal", user: "root", port: 22, proxy: { type: "traefik" },
      proxy_type: "traefik", high_disk_usage_notification_sent: false,
      unreachable_notification_sent: false, unreachable_count: 0,
      validation_logs: null, log_drain_notification_sent: false,
      swarm_cluster: null, settings: { id: 1, is_reachable: true },
    };
    const r = CoolifyServerSchema.safeParse(real);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({
      uuid: "rc7cv7kbvocgj36bjgucsouc", name: "localhost", ip: "host.docker.internal",
    });
  });

  it("accepts a server with a null ip", () => {
    expect(
      CoolifyServerSchema.safeParse({ uuid: "u", name: "n", ip: null }).success,
    ).toBe(true);
  });

  it("accepts a full project object", () => {
    expect(
      CoolifyProjectSchema.safeParse({
        id: 1, uuid: "p-1", name: "my-project", description: null,
      }).success,
    ).toBe(true);
  });

  it("rejects only what actually breaks the picker", () => {
    expect(CoolifyServerSchema.safeParse({ uuid: "u" }).success).toBe(false);
    expect(CoolifyServerSchema.safeParse({ uuid: "u", name: null }).success).toBe(false);
  });
});
