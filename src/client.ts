import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig, McpToolInfo } from "./types.js";

/** Concurrency limits per transport type */
const CONCURRENCY: Record<string, number> = {
  stdio: 1,
  http: 4,
  sse: 2,
};

export interface McpClientOptions {
  serverName: string;
  config: McpServerConfig;
  onError?: (err: Error) => void;
}

/**
 * Wraps @modelcontextprotocol/sdk Client with transport auto-detection,
 * connection management, and concurrency limiting.
 */
export class McpClientWrapper {
  readonly serverName: string;
  private config: McpServerConfig;
  private client: Client | null = null;
  private onError?: (err: Error) => void;
  private pendingCalls = 0;
  private callQueue: Array<() => void> = [];

  constructor(opts: McpClientOptions) {
    this.serverName = opts.serverName;
    this.config = opts.config;
    this.onError = opts.onError;
  }

  get maxConcurrency(): number {
    return CONCURRENCY[this.config.transport] ?? 4;
  }

  get isConnected(): boolean {
    return this.client !== null;
  }

  /** Connect to the MCP server */
  async connect(): Promise<void> {
    if (this.client) return;

    const client = new Client(
      { name: `openclaw-mcp/${this.serverName}`, version: "0.1.0" },
      { capabilities: {} },
    );

    const transport = this.createTransport();
    await client.connect(transport);
    this.client = client;
  }

  /** Disconnect from the MCP server */
  async disconnect(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.close();
    } finally {
      this.client = null;
      this.pendingCalls = 0;
      this.callQueue = [];
    }
  }

  /** Check connection health */
  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  /** List available tools from the server */
  async listTools(): Promise<McpToolInfo[]> {
    this.ensureConnected();
    const result = await this.client!.listTools();
    return (result.tools ?? []).map((t) => ({
      serverName: this.serverName,
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
    }));
  }

  /** Call a tool on the server with concurrency limiting */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolCallResult> {
    this.ensureConnected();

    // Wait for a concurrency slot
    if (this.pendingCalls >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.callQueue.push(resolve));
    }
    this.pendingCalls++;

    try {
      const result = await this.client!.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal, timeout: this.config.timeout },
      );
      return {
        content: (result.content ?? []) as ToolContent[],
        isError: result.isError ?? false,
      };
    } finally {
      this.pendingCalls--;
      // Release next queued call
      const next = this.callQueue.shift();
      if (next) next();
    }
  }

  private ensureConnected(): asserts this is { client: Client } {
    if (!this.client) {
      throw new Error(
        `MCP server "${this.serverName}" is not connected`,
      );
    }
  }

  private createTransport() {
    switch (this.config.transport) {
      case "stdio":
        return this.createStdioTransport();
      case "http":
        return this.createHttpTransport();
      case "sse":
        return this.createSseTransport();
      default:
        throw new Error(
          `Unknown transport "${this.config.transport}" for server "${this.serverName}"`,
        );
    }
  }

  private createStdioTransport() {
    if (!this.config.command) {
      throw new Error(
        `Server "${this.serverName}": stdio transport requires "command"`,
      );
    }
    return new StdioClientTransport({
      command: this.config.command,
      args: this.config.args ?? [],
      env: {
        ...process.env,
        ...(this.config.env ?? {}),
      } as Record<string, string>,
    });
  }

  private createHttpTransport() {
    if (!this.config.url) {
      throw new Error(
        `Server "${this.serverName}": http transport requires "url"`,
      );
    }
    return new StreamableHTTPClientTransport(new URL(this.config.url), {
      requestInit: {
        headers: this.config.headers ?? {},
      },
    });
  }

  private createSseTransport() {
    if (!this.config.url) {
      throw new Error(
        `Server "${this.serverName}": sse transport requires "url"`,
      );
    }
    return new SSEClientTransport(new URL(this.config.url), {
      requestInit: {
        headers: this.config.headers ?? {},
      },
    });
  }
}

/** A single content block from an MCP tool result */
export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; text?: string; blob?: string; mimeType?: string } };

/** Result from an MCP tool call */
export interface ToolCallResult {
  content: ToolContent[];
  isError: boolean;
}
