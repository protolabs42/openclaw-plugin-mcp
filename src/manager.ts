import { McpClientWrapper } from "./client.js";
import { createBridgedTools, type BridgedTool } from "./bridge.js";
import type {
  McpPluginConfig,
  McpServerConfig,
  ManagedServer,
  McpServerStatus,
  ConnectionState,
} from "./types.js";

/**
 * Manages multiple MCP server connections, tool discovery, and lifecycle.
 * Uses lazy initialization - servers connect on first tool request.
 */
export class McpServerManager {
  private servers = new Map<string, ManagedServer>();
  private config: McpPluginConfig;
  private log: (msg: string) => void;

  constructor(config: McpPluginConfig, log?: (msg: string) => void) {
    this.config = config;
    this.log = log ?? console.log.bind(console);
    this.initializeServers();
  }

  private initializeServers() {
    for (const [name, cfg] of Object.entries(this.config.servers)) {
      if (!cfg.enabled) continue;
      this.servers.set(name, {
        name,
        config: cfg,
        client: null,
        state: "disconnected",
        tools: [],
      });
    }
  }

  /** Connect to a specific server and discover its tools */
  async connectServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) throw new Error(`Unknown MCP server: ${name}`);
    if (server.state === "connected") return;

    // Deduplicate concurrent connect attempts
    if (server.connectPromise) {
      await server.connectPromise;
      return;
    }

    server.connectPromise = this.doConnect(server);
    try {
      await server.connectPromise;
    } finally {
      server.connectPromise = undefined;
    }
  }

  private async doConnect(server: ManagedServer): Promise<void> {
    const retries = this.config.defaults.retries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        this.setState(server, "connecting");
        this.log(
          `[mcp] Connecting to "${server.name}"${attempt > 0 ? ` (retry ${attempt}/${retries})` : ""}...`,
        );

        const client = new McpClientWrapper({
          serverName: server.name,
          config: server.config,
          onError: (err) => {
            this.log(`[mcp] Error from "${server.name}": ${err.message}`);
            this.setState(server, "error", err.message);
          },
        });

        await client.connect();
        const tools = await client.listTools();

        server.client = client as any;
        server.tools = tools;
        server.lastPing = Date.now();
        server.error = undefined;
        // Store the wrapper for later use
        (server as any)._wrapper = client;
        this.setState(server, "connected");

        this.log(
          `[mcp] Connected to "${server.name}" — ${tools.length} tool(s) available`,
        );
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.log(
          `[mcp] Failed to connect to "${server.name}": ${lastError.message}`,
        );

        if (attempt < retries) {
          // Exponential backoff: 1s, 2s, 4s...
          const delay = 1000 * 2 ** attempt;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    this.setState(server, "error", lastError?.message);
    throw lastError ?? new Error(`Failed to connect to "${server.name}"`);
  }

  /** Connect to all enabled servers */
  async connectAll(): Promise<void> {
    const names = [...this.servers.keys()];
    const results = await Promise.allSettled(
      names.map((name) => this.connectServer(name)),
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") {
        const reason =
          results[i].status === "rejected"
            ? (results[i] as PromiseRejectedResult).reason
            : null;
        this.log(
          `[mcp] Server "${names[i]}" failed to connect: ${reason?.message ?? "unknown"}`,
        );
      }
    }
  }

  /** Disconnect from a specific server */
  async disconnectServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;

    const wrapper = (server as any)._wrapper as McpClientWrapper | undefined;
    if (wrapper) {
      try {
        await wrapper.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }

    server.client = null;
    (server as any)._wrapper = undefined;
    server.tools = [];
    this.setState(server, "disconnected");
    this.log(`[mcp] Disconnected from "${name}"`);
  }

  /** Disconnect from all servers */
  async disconnectAll(): Promise<void> {
    await Promise.allSettled(
      [...this.servers.keys()].map((name) => this.disconnectServer(name)),
    );
  }

  /** Get all bridged tools from all connected servers (async, triggers lazy connect) */
  async getAllTools(): Promise<BridgedTool[]> {
    // Lazily connect servers that aren't connected yet
    await this.connectAll();
    return this.getCachedTools();
  }

  /** Get tools from already-connected servers (synchronous, no connection attempts) */
  getCachedTools(): BridgedTool[] {
    const tools: BridgedTool[] = [];
    for (const server of this.servers.values()) {
      if (server.state !== "connected") continue;
      const wrapper = (server as any)._wrapper as McpClientWrapper;
      if (!wrapper) continue;
      tools.push(...createBridgedTools(wrapper, server.tools, server.config));
    }
    return tools;
  }

  /** Get status for all servers */
  getStatus(): McpServerStatus[] {
    return [...this.servers.values()].map((s) => ({
      name: s.name,
      state: s.state,
      transport: s.config.transport,
      toolCount: s.tools.length,
      tools: s.tools.map((t) => t.name),
      error: s.error,
      lastPing: s.lastPing,
    }));
  }

  /** Get status for a specific server */
  getServerStatus(name: string): McpServerStatus | null {
    const s = this.servers.get(name);
    if (!s) return null;
    return {
      name: s.name,
      state: s.state,
      transport: s.config.transport,
      toolCount: s.tools.length,
      tools: s.tools.map((t) => t.name),
      error: s.error,
      lastPing: s.lastPing,
    };
  }

  /** Check if any servers are configured */
  get hasServers(): boolean {
    return this.servers.size > 0;
  }

  /** Get list of server names */
  get serverNames(): string[] {
    return [...this.servers.keys()];
  }

  private setState(
    server: ManagedServer,
    state: ConnectionState,
    error?: string,
  ) {
    server.state = state;
    if (error !== undefined) server.error = error;
  }
}
