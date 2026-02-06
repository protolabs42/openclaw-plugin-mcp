import { describe, it, expect } from "vitest";
import { parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("returns empty config for undefined input", () => {
    const cfg = parseConfig(undefined);
    expect(cfg.servers).toEqual({});
    expect(cfg.defaults.trust).toBe("untrusted");
    expect(cfg.defaults.timeout).toBe(30_000);
    expect(cfg.defaults.retries).toBe(2);
    expect(cfg.defaults.maxResultChars).toBe(50_000);
  });

  it("parses a minimal stdio server", () => {
    const cfg = parseConfig({
      servers: {
        context7: { command: "npx", args: ["-y", "@context7/mcp"] },
      },
    });
    expect(cfg.servers.context7).toBeDefined();
    expect(cfg.servers.context7.transport).toBe("stdio");
    expect(cfg.servers.context7.enabled).toBe(true);
    expect(cfg.servers.context7.command).toBe("npx");
    expect(cfg.servers.context7.trust).toBe("untrusted");
  });

  it("auto-detects http transport from url", () => {
    const cfg = parseConfig({
      servers: {
        remote: { url: "https://mcp.example.com" },
      },
    });
    expect(cfg.servers.remote.transport).toBe("http");
  });

  it("respects explicit transport override", () => {
    const cfg = parseConfig({
      servers: {
        legacy: { url: "https://old.example.com", transport: "sse" },
      },
    });
    expect(cfg.servers.legacy.transport).toBe("sse");
  });

  it("merges server config with defaults", () => {
    const cfg = parseConfig({
      defaults: { trust: "trusted", timeout: 5000 },
      servers: {
        fast: { command: "node", args: ["server.js"] },
        custom: { command: "node", args: ["server.js"], trust: "sanitize", timeout: 10000 },
      },
    });
    expect(cfg.servers.fast.trust).toBe("trusted");
    expect(cfg.servers.fast.timeout).toBe(5000);
    expect(cfg.servers.custom.trust).toBe("sanitize");
    expect(cfg.servers.custom.timeout).toBe(10000);
  });

  it("skips disabled servers but still parses them", () => {
    const cfg = parseConfig({
      servers: {
        off: { command: "npx", args: ["server"], enabled: false },
      },
    });
    expect(cfg.servers.off.enabled).toBe(false);
  });

  it("handles tool filters", () => {
    const cfg = parseConfig({
      servers: {
        filtered: {
          command: "npx",
          args: ["server"],
          toolFilter: { allow: ["read"], deny: ["write"] },
        },
      },
    });
    expect(cfg.servers.filtered.toolFilter?.allow).toEqual(["read"]);
    expect(cfg.servers.filtered.toolFilter?.deny).toEqual(["write"]);
  });
});
