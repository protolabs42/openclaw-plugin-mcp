import type { McpToolInfo, McpServerConfig, ToolFilter } from "./types.js";
import type { McpClientWrapper, ToolCallResult } from "./client.js";
import { applyTrustPolicy } from "./security.js";

/** Content types matching openclaw's AgentToolResult */
interface TextContent {
  type: "text";
  text: string;
}

interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

interface AgentToolResult {
  content: (TextContent | ImageContent)[];
  details: unknown;
}

/**
 * An openclaw-compatible tool definition.
 * Uses the same shape as AgentTool from pi-agent-core.
 */
export interface BridgedTool {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<AgentToolResult>;
}

/** Check if a tool passes the allow/deny filter */
function passesFilter(toolName: string, filter?: ToolFilter): boolean {
  if (!filter) return true;
  if (filter.deny?.includes(toolName)) return false;
  if (filter.allow && filter.allow.length > 0) {
    return filter.allow.includes(toolName);
  }
  return true;
}

/** Normalize the MCP tool name for openclaw (lowercase, safe chars) */
function normalizeToolName(serverName: string, toolName: string): string {
  const safe = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  return `mcp_${safe(serverName)}_${safe(toolName)}`;
}

/** Ensure schema has top-level type: "object" (required by OpenAI) */
function normalizeSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...schema };
  if (!result.type) {
    result.type = "object";
  }
  return result;
}

/** Convert MCP tool call result to openclaw AgentToolResult */
function convertResult(
  result: ToolCallResult,
  config: McpServerConfig,
): AgentToolResult {
  const secured = applyTrustPolicy(result, config.trust, config.maxResultChars);
  const content: (TextContent | ImageContent)[] = [];

  for (const block of secured.content) {
    switch (block.type) {
      case "text":
        content.push({ type: "text", text: block.text });
        break;
      case "image":
        content.push({
          type: "image",
          data: block.data,
          mimeType: block.mimeType,
        });
        break;
      default:
        // Resource blocks are converted to text by security layer
        content.push({
          type: "text",
          text: JSON.stringify(block, null, 2),
        });
    }
  }

  if (secured.isError) {
    const errorText = content
      .filter((c): c is TextContent => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    return {
      content: [
        { type: "text", text: `[MCP Error] ${errorText || "Unknown error"}` },
      ],
      details: { error: true, serverError: true },
    };
  }

  if (content.length === 0) {
    content.push({ type: "text", text: "(empty result)" });
  }

  return { content, details: { mcpResult: true } };
}

/**
 * Create openclaw AgentTool definitions from MCP server tools.
 * Each MCP tool becomes a namespaced openclaw tool.
 */
export function createBridgedTools(
  client: McpClientWrapper,
  tools: McpToolInfo[],
  config: McpServerConfig,
): BridgedTool[] {
  return tools
    .filter((t) => passesFilter(t.name, config.toolFilter))
    .map((tool) => ({
      name: normalizeToolName(client.serverName, tool.name),
      label: tool.name,
      description: [
        `[MCP: ${client.serverName}]`,
        tool.description ?? `Tool "${tool.name}" from MCP server "${client.serverName}"`,
      ].join(" "),
      parameters: normalizeSchema(tool.inputSchema),
      execute: async (
        _toolCallId: string,
        params: Record<string, unknown>,
        signal?: AbortSignal,
      ): Promise<AgentToolResult> => {
        const result = await client.callTool(tool.name, params, signal);
        return convertResult(result, config);
      },
    }));
}
