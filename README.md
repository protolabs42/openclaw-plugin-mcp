# openclaw-plugin-mcp

Native MCP (Model Context Protocol) client support for [OpenClaw](https://github.com/openclaw/openclaw). Connect to any MCP server and use its tools natively from your OpenClaw agent.

## Install

Clone and link locally (not yet published to npm):

```bash
git clone https://github.com/protolabs42/openclaw-plugin-mcp
cd openclaw-plugin-mcp
npm install
openclaw plugins install -l .
```

Then restart your gateway. The plugin will appear as **loaded** in `openclaw plugins list`.

## Quick Start

1. Install the plugin (see above)
2. Add an MCP server from the built-in catalog:

```bash
openclaw mcp add context7 --from-catalog
```

3. Restart the gateway
4. Your agent now has native access to context7's tools (`mcp_context7_resolve_library_id`, `mcp_context7_query_docs`)

## Configuration

Configure in your OpenClaw config (`~/.openclaw/openclaw.json`):

```json5
{
  plugins: {
    entries: {
      "openclaw-plugin-mcp": {
        enabled: true,
        config: {
          servers: {
            // Stdio transport (local servers)
            context7: {
              command: "npx",
              args: ["-y", "@upstash/context7-mcp@latest"],
              trust: "trusted"
            },
            // HTTP transport (remote servers)
            remote: {
              url: "https://mcp.example.com",
              headers: { "Authorization": "Bearer ..." },
              trust: "untrusted"
            },
            // SSE transport (legacy remote)
            legacy: {
              url: "https://old.example.com/sse",
              transport: "sse",
              trust: "sanitize"
            }
          },
          defaults: {
            trust: "untrusted",
            timeout: 30000,
            retries: 2,
            maxResultChars: 50000
          }
        }
      }
    }
  }
}
```

### Transport Auto-Detection

- Has `command` -> stdio (spawns a local process)
- Has `url` -> HTTP (Streamable HTTP transport)
- Set `transport: "sse"` explicitly for legacy SSE servers

### Trust Levels

| Level | Behavior |
|-------|----------|
| `trusted` | Results passed directly to agent |
| `untrusted` | Results prefixed with warning (default) |
| `sanitize` | HTML/scripts stripped, images removed, data URIs cleaned |

### Tool Filtering

Restrict which tools from a server are exposed:

```json5
{
  "web-scraper": {
    command: "npx",
    args: ["-y", "mcp-scraper"],
    trust: "sanitize",
    toolFilter: {
      deny: ["write_file", "delete_file"]  // Block dangerous tools
    }
  }
}
```

## CLI Commands

```bash
openclaw mcp list              # List servers + connection status
openclaw mcp catalog           # Browse built-in server catalog
openclaw mcp add <name>        # Add a server (--from-catalog, --command, --url)
openclaw mcp remove <name>     # Remove a server
openclaw mcp tools [server]    # List available MCP tools
openclaw mcp status            # Connection summary
```

## Built-in Catalog

Pre-configured popular MCP servers:

| Name | Category | Description |
|------|----------|-------------|
| context7 | documentation | Up-to-date docs for any library |
| filesystem | filesystem | Read/write local files |
| memory | memory | Knowledge graph persistence |
| github | developer | GitHub API access |
| brave-search | search | Web search via Brave |
| slack | communication | Slack workspace access |
| postgres | database | PostgreSQL access |
| sqlite | database | SQLite access |
| puppeteer | browser | Browser automation |
| fetch | web | Fetch web pages as Markdown |
| sequential_thinking | reasoning | Structured problem-solving |
| exa | search | AI-powered web search |

## How It Works

1. Plugin registers as an OpenClaw extension with a synchronous tool factory
2. On gateway start, the service connects to all configured MCP servers
3. Discovers tools via MCP `tools/list`
4. Bridges each MCP tool as an OpenClaw agent tool (`mcp_{server}_{tool}`)
5. When the agent calls a tool, the request is proxied to the MCP server
6. Results are processed through the security layer before returning to the agent

## Architecture

```
OpenClaw Gateway
    |
    +-- openclaw-plugin-mcp
         |
         +-- McpServerManager (lifecycle, connection pool)
         |    +-- McpClientWrapper (stdio)  --> context7
         |    +-- McpClientWrapper (http)   --> remote server
         |    +-- McpClientWrapper (sse)    --> legacy server
         |
         +-- Tool Bridge (MCP tools --> OpenClaw AgentTool)
         |    +-- Schema passthrough + normalization
         |    +-- Result conversion + security policy
         |
         +-- Gateway RPC (mcp.list, mcp.status, mcp.tools)
         +-- CLI Commands (openclaw mcp ...)
```

## Development

```bash
git clone https://github.com/protolabs42/openclaw-plugin-mcp
cd openclaw-plugin-mcp
npm install
npm test

# Link for local development
openclaw plugins install -l .
```

## License

MIT
