import { parseConfig } from "./src/config.js";
import { McpServerManager } from "./src/manager.js";
import { listCatalog, getCatalogEntry, catalogToConfig } from "./src/registry.js";
import type { McpPluginConfig } from "./src/types.js";

// Types from openclaw plugin SDK (peer dependency)
interface PluginApi {
  id: string;
  pluginConfig?: Record<string, unknown>;
  logger: { info: (msg: string) => void; error: (msg: string) => void; warn: (msg: string) => void };
  runtime: {
    config: { loadConfig: () => any; writeConfigFile: (config: any) => Promise<void> };
  };
  registerTool: (tool: any, opts?: any) => void;
  registerService: (service: any) => void;
  registerGatewayMethod: (method: string, handler: any) => void;
  registerCli: (registrar: any, opts?: any) => void;
}

let manager: McpServerManager | null = null;
let config: McpPluginConfig | null = null;

function ensureManagerSync(api: PluginApi): McpServerManager {
  if (manager) return manager;

  config = parseConfig(api.pluginConfig);
  manager = new McpServerManager(config, (msg) => api.logger.info(msg));
  return manager;
}

async function ensureManager(api: PluginApi): Promise<McpServerManager> {
  return ensureManagerSync(api);
}

export default {
  id: "openclaw-plugin-mcp",
  name: "MCP Client",
  description: "Native MCP server support — connect to any MCP server and use its tools",

  configSchema: {
    parse(value: unknown) {
      return parseConfig(value);
    },
  },

  register(api: PluginApi) {
    const log = api.logger;

    // Register MCP tools as openclaw agent tools (synchronous factory).
    // The service start() connects servers before tools are resolved,
    // so getCachedTools() returns already-discovered tools.
    api.registerTool(
      () => {
        try {
          const mgr = ensureManagerSync(api);
          if (!mgr.hasServers) return [];
          return mgr.getCachedTools();
        } catch (err) {
          log.error(
            `[mcp-client] Failed to load MCP tools: ${err instanceof Error ? err.message : err}`,
          );
          return [];
        }
      },
    );

    // Background service for connection lifecycle
    api.registerService({
      id: "openclaw-plugin-mcp",
      async start() {
        try {
          const mgr = await ensureManager(api);
          if (mgr.hasServers) {
            log.info("[mcp-client] Starting MCP server connections...");
            await mgr.connectAll();
          }
        } catch (err) {
          log.error(
            `[mcp-client] Service start error: ${err instanceof Error ? err.message : err}`,
          );
        }
      },
      async stop() {
        if (manager) {
          log.info("[mcp-client] Shutting down MCP connections...");
          await manager.disconnectAll();
          manager = null;
          config = null;
        }
      },
    });

    // --- Gateway RPC methods ---

    api.registerGatewayMethod("mcp.list", ({ respond }) => {
      if (!manager) {
        respond(true, { servers: [], message: "MCP client not initialized" });
        return;
      }
      respond(true, { servers: manager.getStatus() });
    });

    api.registerGatewayMethod("mcp.status", ({ respond }) => {
      if (!manager) {
        respond(true, { status: "not_initialized", servers: [] });
        return;
      }
      const servers = manager.getStatus();
      const connected = servers.filter((s) => s.state === "connected").length;
      respond(true, {
        status: connected > 0 ? "active" : "inactive",
        connected,
        total: servers.length,
        servers,
      });
    });

    api.registerGatewayMethod("mcp.tools", ({ respond }) => {
      if (!manager) {
        respond(true, { tools: [] });
        return;
      }
      const all = manager.getStatus().flatMap((s) =>
        s.tools.map((t) => ({
          server: s.name,
          tool: t,
          fullName: `mcp_${s.name}_${t}`,
        })),
      );
      respond(true, { tools: all });
    });

    api.registerGatewayMethod("mcp.catalog", ({ respond }) => {
      respond(true, { catalog: listCatalog() });
    });

    api.registerGatewayMethod(
      "mcp.restart",
      async ({ request, respond }: { request: any; respond: any }) => {
        const name = request?.params?.server;
        if (!name || !manager) {
          respond(false, { error: "Server name required" });
          return;
        }
        try {
          await manager.disconnectServer(name);
          await manager.connectServer(name);
          respond(true, { server: manager.getServerStatus(name) });
        } catch (err) {
          respond(false, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );

    // --- CLI commands ---

    api.registerCli(
      ({ program }: any) => {
        const mcp = program.command("mcp").description("Manage MCP server connections");

        mcp
          .command("list")
          .description("List configured MCP servers and their status")
          .action(async () => {
            const mgr = await ensureManager(api);
            if (!mgr.hasServers) {
              console.log("No MCP servers configured.");
              console.log('Run "openclaw mcp catalog" to see available servers.');
              return;
            }
            const statuses = mgr.getStatus();
            for (const s of statuses) {
              const icon =
                s.state === "connected"
                  ? "+"
                  : s.state === "error"
                    ? "x"
                    : "-";
              console.log(
                `[${icon}] ${s.name} (${s.transport}) — ${s.state}${s.toolCount > 0 ? ` — ${s.toolCount} tools` : ""}${s.error ? ` — ${s.error}` : ""}`,
              );
            }
          });

        mcp
          .command("catalog")
          .description("Show built-in MCP server catalog")
          .action(() => {
            const entries = listCatalog();
            console.log("Available MCP servers:\n");
            for (const e of entries) {
              console.log(`  ${e.name}`);
              console.log(`    ${e.description}`);
              console.log(`    Category: ${e.category} | Trust: ${e.trust}`);
              if (e.env && Object.keys(e.env).length > 0) {
                const envKeys = Object.keys(e.env).join(", ");
                console.log(`    Requires: ${envKeys}`);
              }
              console.log();
            }
            console.log(
              'Add a server: openclaw mcp add <name> --from-catalog',
            );
          });

        mcp
          .command("add <name>")
          .description("Add an MCP server")
          .option("--from-catalog", "Add from built-in catalog")
          .option("--command <cmd>", "Command to spawn (stdio)")
          .option("--url <url>", "Server URL (http/sse)")
          .option("--trust <level>", "Trust level: trusted, untrusted, sanitize")
          .action(async (name: string, opts: any) => {
            let serverConfig: Record<string, unknown>;

            if (opts.fromCatalog) {
              const entry = getCatalogEntry(name);
              if (!entry) {
                console.error(`"${name}" not found in catalog.`);
                console.log('Run "openclaw mcp catalog" to see available servers.');
                return;
              }
              serverConfig = catalogToConfig(entry);
              console.log(`Adding "${name}" from catalog: ${entry.description}`);

              if (entry.env) {
                const missing = Object.entries(entry.env)
                  .filter(([, v]) => !v)
                  .map(([k]) => k);
                if (missing.length > 0) {
                  console.log(
                    `\nNote: Set these environment variables in the server config:`
                  );
                  for (const k of missing) console.log(`  ${k}`);
                }
              }
            } else if (opts.command) {
              serverConfig = {
                enabled: true,
                command: opts.command,
                trust: opts.trust ?? "untrusted",
              };
            } else if (opts.url) {
              serverConfig = {
                enabled: true,
                url: opts.url,
                trust: opts.trust ?? "untrusted",
              };
            } else {
              console.error(
                "Provide --from-catalog, --command, or --url",
              );
              return;
            }

            // Write to openclaw config
            try {
              const fullConfig = api.runtime.config.loadConfig();
              if (!fullConfig.plugins) fullConfig.plugins = {};
              if (!fullConfig.plugins.entries) fullConfig.plugins.entries = {};
              if (!fullConfig.plugins.entries["openclaw-plugin-mcp"])
                fullConfig.plugins.entries["openclaw-plugin-mcp"] = { enabled: true, config: {} };
              if (!fullConfig.plugins.entries["openclaw-plugin-mcp"].config)
                fullConfig.plugins.entries["openclaw-plugin-mcp"].config = {};
              if (!fullConfig.plugins.entries["openclaw-plugin-mcp"].config.servers)
                fullConfig.plugins.entries["openclaw-plugin-mcp"].config.servers = {};

              fullConfig.plugins.entries["openclaw-plugin-mcp"].config.servers[name] =
                serverConfig;

              await api.runtime.config.writeConfigFile(fullConfig);
              console.log(`\nAdded "${name}". Restart the gateway to activate.`);
            } catch (err) {
              console.error(
                `Failed to write config: ${err instanceof Error ? err.message : err}`,
              );
            }
          });

        mcp
          .command("remove <name>")
          .description("Remove an MCP server")
          .action(async (name: string) => {
            try {
              const fullConfig = api.runtime.config.loadConfig();
              const servers =
                fullConfig?.plugins?.entries?.["openclaw-plugin-mcp"]?.config?.servers;
              if (!servers || !servers[name]) {
                console.error(`Server "${name}" not found in config.`);
                return;
              }
              delete servers[name];
              await api.runtime.config.writeConfigFile(fullConfig);
              console.log(
                `Removed "${name}". Restart the gateway to apply.`,
              );
            } catch (err) {
              console.error(
                `Failed to write config: ${err instanceof Error ? err.message : err}`,
              );
            }
          });

        mcp
          .command("tools [server]")
          .description("List available MCP tools")
          .action(async (server?: string) => {
            const mgr = await ensureManager(api);
            const statuses = mgr.getStatus();
            const filtered = server
              ? statuses.filter((s) => s.name === server)
              : statuses;

            if (filtered.length === 0) {
              console.log(
                server
                  ? `Server "${server}" not found.`
                  : "No MCP servers configured.",
              );
              return;
            }

            for (const s of filtered) {
              console.log(`\n${s.name} (${s.state}):`);
              if (s.tools.length === 0) {
                console.log("  (no tools)");
              } else {
                for (const t of s.tools) {
                  console.log(`  - mcp_${s.name}_${t}`);
                }
              }
            }
          });

        mcp
          .command("status")
          .description("Show MCP connection status")
          .action(async () => {
            const mgr = await ensureManager(api);
            const statuses = mgr.getStatus();
            const connected = statuses.filter(
              (s) => s.state === "connected",
            ).length;
            console.log(
              `MCP: ${connected}/${statuses.length} servers connected`,
            );
            const totalTools = statuses.reduce(
              (n, s) => n + s.toolCount,
              0,
            );
            console.log(`Tools: ${totalTools} available`);
            console.log();
            for (const s of statuses) {
              console.log(
                `  ${s.name}: ${s.state} (${s.transport}) — ${s.toolCount} tools`,
              );
            }
          });
      },
      { commands: ["mcp"] },
    );

    log.info(
      `[mcp-client] Plugin registered — ${Object.keys(config?.servers ?? api.pluginConfig?.servers ?? {}).length} server(s) configured`,
    );
  },
};
