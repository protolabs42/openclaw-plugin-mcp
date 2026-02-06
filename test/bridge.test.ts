import { describe, it, expect } from "vitest";
import { createBridgedTools } from "../src/bridge.js";
import type { McpToolInfo, McpServerConfig } from "../src/types.js";

// Mock client that returns canned results
function mockClient(name: string) {
  return {
    serverName: name,
    isConnected: true,
    callTool: async (_name: string, _args: Record<string, unknown>) => ({
      content: [{ type: "text" as const, text: "mock result" }],
      isError: false,
    }),
  } as any;
}

const defaultConfig: McpServerConfig = {
  enabled: true,
  transport: "stdio",
  command: "echo",
  trust: "trusted",
  maxResultChars: 50000,
  timeout: 30000,
};

const sampleTools: McpToolInfo[] = [
  {
    serverName: "test",
    name: "read_file",
    description: "Read a file",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    serverName: "test",
    name: "write_file",
    description: "Write a file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
];

describe("createBridgedTools", () => {
  it("creates namespaced tools from MCP definitions", () => {
    const tools = createBridgedTools(mockClient("test"), sampleTools, defaultConfig);
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("mcp_test_read_file");
    expect(tools[1].name).toBe("mcp_test_write_file");
  });

  it("includes server name in description", () => {
    const tools = createBridgedTools(mockClient("ctx7"), sampleTools, defaultConfig);
    expect(tools[0].description).toContain("[MCP: ctx7]");
  });

  it("passes through input schema", () => {
    const tools = createBridgedTools(mockClient("test"), sampleTools, defaultConfig);
    expect(tools[0].parameters).toEqual(sampleTools[0].inputSchema);
  });

  it("ensures top-level type: object", () => {
    const noType: McpToolInfo[] = [
      {
        serverName: "test",
        name: "bare",
        inputSchema: { properties: { x: { type: "string" } } },
      },
    ];
    const tools = createBridgedTools(mockClient("test"), noType, defaultConfig);
    expect(tools[0].parameters.type).toBe("object");
  });

  it("executes tool and returns result", async () => {
    const tools = createBridgedTools(mockClient("test"), sampleTools, defaultConfig);
    const result = await tools[0].execute("call-1", { path: "/tmp/test" });
    expect(result.content[0]).toEqual({ type: "text", text: "mock result" });
  });

  it("applies toolFilter deny list", () => {
    const config: McpServerConfig = {
      ...defaultConfig,
      toolFilter: { deny: ["write_file"] },
    };
    const tools = createBridgedTools(mockClient("test"), sampleTools, config);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("mcp_test_read_file");
  });

  it("applies toolFilter allow list", () => {
    const config: McpServerConfig = {
      ...defaultConfig,
      toolFilter: { allow: ["write_file"] },
    };
    const tools = createBridgedTools(mockClient("test"), sampleTools, config);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("mcp_test_write_file");
  });

  it("normalizes tool names with special chars", () => {
    const special: McpToolInfo[] = [
      {
        serverName: "My Server",
        name: "read-file.v2",
        inputSchema: { type: "object" },
      },
    ];
    const tools = createBridgedTools(mockClient("My Server"), special, defaultConfig);
    expect(tools[0].name).toBe("mcp_my_server_read_file_v2");
  });
});
