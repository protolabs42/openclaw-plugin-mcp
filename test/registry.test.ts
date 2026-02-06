import { describe, it, expect } from "vitest";
import {
  getCatalogEntry,
  listCatalog,
  catalogToConfig,
  listCatalogByCategory,
} from "../src/registry.js";

describe("registry", () => {
  it("has context7 in catalog", () => {
    const entry = getCatalogEntry("context7");
    expect(entry).toBeDefined();
    expect(entry!.command).toBe("npx");
    expect(entry!.trust).toBe("trusted");
    expect(entry!.category).toBe("documentation");
  });

  it("returns undefined for unknown server", () => {
    expect(getCatalogEntry("nonexistent")).toBeUndefined();
  });

  it("lists all catalog entries", () => {
    const all = listCatalog();
    expect(all.length).toBeGreaterThan(5);
    expect(all.every((e) => e.name && e.description)).toBe(true);
  });

  it("converts catalog entry to server config", () => {
    const entry = getCatalogEntry("context7")!;
    const config = catalogToConfig(entry);
    expect(config.enabled).toBe(true);
    expect(config.command).toBe("npx");
    expect(config.trust).toBe("trusted");
  });

  it("applies overrides to catalog config", () => {
    const entry = getCatalogEntry("context7")!;
    const config = catalogToConfig(entry, { trust: "sanitize", timeout: 5000 });
    expect(config.trust).toBe("sanitize");
    expect(config.timeout).toBe(5000);
  });

  it("groups catalog by category", () => {
    const grouped = listCatalogByCategory();
    expect(grouped.documentation).toBeDefined();
    expect(grouped.documentation.some((e) => e.name === "context7")).toBe(true);
  });
});
