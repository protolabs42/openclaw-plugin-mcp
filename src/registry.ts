import type { CatalogEntry, McpServerConfig } from "./types.js";

/**
 * Built-in catalog of well-known MCP servers.
 * Users can add servers from this catalog with `openclaw mcp add <name> --catalog`
 */
export const CATALOG: Record<string, CatalogEntry> = {
  context7: {
    description: "Up-to-date documentation and code examples for any library",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp@latest"],
    trust: "trusted",
    category: "documentation",
  },
  filesystem: {
    description: "Read and write files on the local filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    trust: "trusted",
    category: "filesystem",
  },
  memory: {
    description: "Knowledge graph-based persistent memory",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    trust: "trusted",
    category: "memory",
  },
  "brave-search": {
    description: "Web search via Brave Search API",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: { BRAVE_API_KEY: "" },
    trust: "untrusted",
    category: "search",
  },
  github: {
    description: "GitHub API - repos, issues, PRs, code search",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
    trust: "trusted",
    category: "developer",
  },
  slack: {
    description: "Slack workspace - channels, messages, users",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    env: { SLACK_BOT_TOKEN: "", SLACK_TEAM_ID: "" },
    trust: "untrusted",
    category: "communication",
  },
  postgres: {
    description: "PostgreSQL database access",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    env: { POSTGRES_CONNECTION_STRING: "" },
    trust: "trusted",
    category: "database",
  },
  sqlite: {
    description: "SQLite database access",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite"],
    trust: "trusted",
    category: "database",
  },
  puppeteer: {
    description: "Browser automation and web scraping",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    trust: "sanitize",
    category: "browser",
  },
  fetch: {
    description: "Fetch and convert web pages to Markdown",
    command: "npx",
    args: ["-y", "@tokenizin/server-fetch"],
    trust: "untrusted",
    category: "web",
  },
  sequential_thinking: {
    description: "Dynamic problem-solving through structured thinking",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    trust: "trusted",
    category: "reasoning",
  },
  exa: {
    description: "AI-powered web search via Exa API",
    command: "npx",
    args: ["-y", "exa-mcp-server"],
    env: { EXA_API_KEY: "" },
    trust: "untrusted",
    category: "search",
  },
};

/** Get a catalog entry by name */
export function getCatalogEntry(name: string): CatalogEntry | undefined {
  return CATALOG[name];
}

/** List all catalog entries */
export function listCatalog(): Array<CatalogEntry & { name: string }> {
  return Object.entries(CATALOG).map(([name, entry]) => ({ name, ...entry }));
}

/** Convert a catalog entry to a server config */
export function catalogToConfig(
  entry: CatalogEntry,
  overrides?: Partial<McpServerConfig>,
): Partial<McpServerConfig> {
  return {
    enabled: true,
    command: entry.command,
    args: entry.args,
    url: entry.url,
    env: entry.env,
    trust: entry.trust,
    ...overrides,
  };
}

/** List catalog entries by category */
export function listCatalogByCategory(): Record<
  string,
  Array<CatalogEntry & { name: string }>
> {
  const result: Record<string, Array<CatalogEntry & { name: string }>> = {};
  for (const [name, entry] of Object.entries(CATALOG)) {
    const cat = entry.category;
    if (!result[cat]) result[cat] = [];
    result[cat].push({ name, ...entry });
  }
  return result;
}
