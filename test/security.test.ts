import { describe, it, expect } from "vitest";
import { applyTrustPolicy } from "../src/security.js";
import type { ToolCallResult } from "../src/client.js";

function textResult(text: string, isError = false): ToolCallResult {
  return { content: [{ type: "text", text }], isError };
}

function imageResult(data = "base64data", mimeType = "image/png"): ToolCallResult {
  return { content: [{ type: "image", data, mimeType }], isError: false };
}

describe("applyTrustPolicy", () => {
  describe("trusted", () => {
    it("passes text through", () => {
      const result = applyTrustPolicy(textResult("hello"), "trusted", 50000);
      expect(result.content[0]).toEqual({ type: "text", text: "hello" });
    });

    it("truncates long text", () => {
      const long = "x".repeat(100);
      const result = applyTrustPolicy(textResult(long), "trusted", 50);
      expect(result.content[0].type).toBe("text");
      const text = (result.content[0] as any).text;
      expect(text.length).toBeLessThan(100);
      expect(text).toContain("truncated");
    });

    it("passes images through", () => {
      const result = applyTrustPolicy(imageResult(), "trusted", 50000);
      expect(result.content[0].type).toBe("image");
    });
  });

  describe("untrusted", () => {
    it("prefixes text with warning", () => {
      const result = applyTrustPolicy(textResult("data"), "untrusted", 50000);
      const text = (result.content[0] as any).text;
      expect(text).toContain("untrusted source");
      expect(text).toContain("data");
    });

    it("still passes images", () => {
      const result = applyTrustPolicy(imageResult(), "untrusted", 50000);
      expect(result.content[0].type).toBe("image");
    });
  });

  describe("sanitize", () => {
    it("strips HTML tags", () => {
      const result = applyTrustPolicy(
        textResult('<div>clean</div><script>alert("xss")</script>'),
        "sanitize",
        50000,
      );
      const text = (result.content[0] as any).text;
      expect(text).toContain("clean");
      expect(text).not.toContain("<script>");
      expect(text).not.toContain("<div>");
    });

    it("strips markdown tracking images", () => {
      const result = applyTrustPolicy(
        textResult("text ![tracker](https://evil.com/track.png) more"),
        "sanitize",
        50000,
      );
      const text = (result.content[0] as any).text;
      expect(text).toContain("[image removed]");
      expect(text).not.toContain("evil.com");
    });

    it("strips data URIs", () => {
      const result = applyTrustPolicy(
        textResult("payload data:text/html,PHA+dGVzdDwvcD4= done"),
        "sanitize",
        50000,
      );
      const text = (result.content[0] as any).text;
      expect(text).toContain("[data-uri removed]");
    });

    it("removes images entirely", () => {
      const result = applyTrustPolicy(imageResult(), "sanitize", 50000);
      expect(result.content[0].type).toBe("text");
      expect((result.content[0] as any).text).toContain("removed");
    });
  });

  describe("resource handling", () => {
    it("converts resources to text for untrusted", () => {
      const result = applyTrustPolicy(
        {
          content: [
            {
              type: "resource",
              resource: { uri: "file:///tmp/data.txt", text: "file content" },
            },
          ],
          isError: false,
        },
        "untrusted",
        50000,
      );
      const text = (result.content[0] as any).text;
      expect(text).toContain("file:///tmp/data.txt");
      expect(text).toContain("file content");
      expect(text).toContain("untrusted");
    });
  });
});
