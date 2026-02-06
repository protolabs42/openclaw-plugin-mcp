import { z } from "zod";
import type {
  McpPluginConfig,
  McpServerConfig,
  McpDefaults,
  TransportType,
  TrustLevel,
} from "./types.js";

const trustLevelSchema = z.enum(["trusted", "untrusted", "sanitize"]);
const transportSchema = z.enum(["stdio", "http", "sse", "auto"]);

const toolFilterSchema = z
  .object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  })
  .optional();

const serverSchema = z.object({
  enabled: z.boolean().optional(),
  transport: transportSchema.optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  trust: trustLevelSchema.optional(),
  maxResultChars: z.number().positive().optional(),
  timeout: z.number().positive().optional(),
  toolFilter: toolFilterSchema,
});

const defaultsSchema = z.object({
  trust: trustLevelSchema.optional(),
  timeout: z.number().positive().optional(),
  retries: z.number().int().min(0).optional(),
  maxResultChars: z.number().positive().optional(),
});

const pluginConfigSchema = z.object({
  servers: z.record(serverSchema).optional(),
  defaults: defaultsSchema.optional(),
});

const DEFAULT_DEFAULTS: McpDefaults = {
  trust: "untrusted",
  timeout: 30_000,
  retries: 2,
  maxResultChars: 50_000,
};

/** Detect transport from server config */
function detectTransport(raw: z.infer<typeof serverSchema>): TransportType {
  if (raw.transport && raw.transport !== "auto") return raw.transport;
  if (raw.command) return "stdio";
  if (raw.url) return "http";
  return "stdio";
}

/** Parse and validate plugin config from raw input */
export function parseConfig(raw: unknown): McpPluginConfig {
  const parsed = pluginConfigSchema.parse(raw ?? {});

  const defaults: McpDefaults = {
    trust: parsed.defaults?.trust ?? DEFAULT_DEFAULTS.trust,
    timeout: parsed.defaults?.timeout ?? DEFAULT_DEFAULTS.timeout,
    retries: parsed.defaults?.retries ?? DEFAULT_DEFAULTS.retries,
    maxResultChars:
      parsed.defaults?.maxResultChars ?? DEFAULT_DEFAULTS.maxResultChars,
  };

  const servers: Record<string, McpServerConfig> = {};

  for (const [name, srv] of Object.entries(parsed.servers ?? {})) {
    servers[name] = {
      enabled: srv.enabled ?? true,
      transport: detectTransport(srv),
      command: srv.command,
      args: srv.args,
      env: srv.env,
      url: srv.url,
      headers: srv.headers,
      trust: srv.trust ?? defaults.trust,
      maxResultChars: srv.maxResultChars ?? defaults.maxResultChars,
      timeout: srv.timeout ?? defaults.timeout,
      toolFilter: srv.toolFilter,
    };
  }

  return { servers, defaults };
}
