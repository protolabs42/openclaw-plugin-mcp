import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/** Trust level for MCP tool results */
export type TrustLevel = "trusted" | "untrusted" | "sanitize";

/** Transport type for MCP server connection */
export type TransportType = "stdio" | "http" | "sse" | "auto";

/** Per-tool allow/deny filter */
export interface ToolFilter {
  allow?: string[];
  deny?: string[];
}

/** Configuration for a single MCP server */
export interface McpServerConfig {
  enabled: boolean;
  transport: TransportType;
  /** Command to spawn (stdio transport) */
  command?: string;
  /** Command arguments (stdio transport) */
  args?: string[];
  /** Environment variables for the server process */
  env?: Record<string, string>;
  /** Server URL (http/sse transport) */
  url?: string;
  /** HTTP headers (http/sse transport) */
  headers?: Record<string, string>;
  /** Trust level for tool results */
  trust: TrustLevel;
  /** Max characters in tool results */
  maxResultChars: number;
  /** Tool call timeout in ms */
  timeout: number;
  /** Tool allow/deny filter */
  toolFilter?: ToolFilter;
}

/** Global defaults for all servers */
export interface McpDefaults {
  trust: TrustLevel;
  timeout: number;
  retries: number;
  maxResultChars: number;
}

/** Full plugin config */
export interface McpPluginConfig {
  servers: Record<string, McpServerConfig>;
  defaults: McpDefaults;
}

/** Connection state for a server */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "reconnecting";

/** Runtime state for a managed MCP server */
export interface ManagedServer {
  name: string;
  config: McpServerConfig;
  client: Client | null;
  state: ConnectionState;
  error?: string;
  tools: McpToolInfo[];
  lastPing?: number;
  connectPromise?: Promise<void>;
}

/** Discovered tool from an MCP server */
export interface McpToolInfo {
  serverName: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** Status info for reporting */
export interface McpServerStatus {
  name: string;
  state: ConnectionState;
  transport: TransportType;
  toolCount: number;
  tools: string[];
  error?: string;
  lastPing?: number;
}

/** Catalog entry for a well-known MCP server */
export interface CatalogEntry {
  description: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  trust: TrustLevel;
  category: string;
}
