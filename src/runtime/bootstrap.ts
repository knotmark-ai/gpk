import { createHash } from "node:crypto";
import { createCraftAdapter, type CraftKnowledgeAdapter } from "../adapters/craft.js";
import { createCraftConnection, type CraftConnection } from "../adapters/craft-connection.js";
import { createLocalControlAdapter, resolveControlRoot } from "../adapters/local-control.js";
import { defaultSecretStore, type SecretStore } from "../adapters/secret-store.js";
import type { Failure, Result } from "../domain/operation-types.js";
import type { KnowledgeBackendConfiguration, KnowledgeLayout, UserControlPort, UserSettings } from "../domain/user-control-port.js";
export type { KnowledgeConnection };
import { createOperations, type KnowledgeBinding } from "./operations.js";
import { createOnboarding } from "../onboarding/server.js";
import { spawn } from "node:child_process";

/** Open a URL in the user's default browser; resolves false when no opener ran. */
export function openBrowser(url: string): Promise<boolean> {
  const [command, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : ["xdg-open", [url]];
  return new Promise(resolve => {
    try {
      const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
      child.once("error", () => resolve(false));
      child.once("spawn", () => { child.unref(); resolve(true); });
    } catch { resolve(false); }
  });
}
import type { KnowledgeConnection } from "../domain/user-control-port.js";

/**
 * Trusted launch bootstrap for the stdio process.
 *
 * The control root comes from the launch environment (`GPK_CONTROL_ROOT`, else
 * `~/.gpk`), never from tool arguments. The knowledge binding is resolved from the
 * active Settings backend on each use, so Setup can change it without a restart.
 * Craft is the only implemented adapter; its tokens live in the host-neutral
 * secret store under the configuration's `credentialsRef` or a derived key.
 */
export type BootstrapOptions = {
  env?: NodeJS.ProcessEnv;
  secrets?: SecretStore;
  createConnection?: typeof createCraftConnection;
  /** Opens the onboarding page; tests replace it so no browser starts. */
  openBrowser?: (url: string) => Promise<boolean>;
};

export const DEFAULT_CRAFT_ENDPOINT = "https://mcp.craft.do/my/mcp";
export const DEFAULT_BACKEND_ID = "craft";

function failure(code: Failure["code"], message: string, next: string): Result<never> {
  return { ok: false, error: { code, message, affected: [], next } };
}

/**
 * The secret-store key used before Settings record one. It is derived from the control
 * root so two roots on one machine (two spaces, or a test root) never share a token
 * entry; the default root keeps the plain form. Settings then record the key Setup used.
 */
export function defaultCredentialsRef(backendId: string, controlRoot: string, home: string | undefined): string {
  const suffix = controlRoot === resolveControlRoot({ HOME: home }) ? "" : `:${createHash("sha256").update(controlRoot).digest("hex").slice(0, 8)}`;
  return `gpk:craft:${backendId}${suffix}`;
}

export function bootstrap(options: BootstrapOptions = {}) {
  const env = options.env ?? process.env;
  const controlRoot = resolveControlRoot(env);
  let secrets: SecretStore | null = options.secrets ?? null;
  const connections = new Map<string, { connection: CraftConnection; knowledge: CraftKnowledgeAdapter }>();

  /** The active layout from current Settings, read on demand so Setup changes apply without restart. */
  async function currentLayout(): Promise<Result<KnowledgeLayout["locations"] | null>> {
    const settings = await control.settings.read();
    if (!settings.ok) return settings;
    if (settings.value === null) return { ok: true, value: null, limits: [] };
    const configuration = activeConfiguration(settings.value.value);
    return configuration.ok ? { ok: true, value: configuration.value.layout.locations, limits: [] } : configuration;
  }
  function bind(backendId: string, endpoint: string, credentialsRef?: string): KnowledgeBinding {
    const secretKey = credentialsRef ?? defaultCredentialsRef(backendId, controlRoot, env.HOME);
    const key = `${backendId}|${endpoint}|${secretKey}`;
    let bound = connections.get(key);
    if (!bound) {
      secrets ??= defaultSecretStore(controlRoot);
      const connection = (options.createConnection ?? createCraftConnection)({ endpoint, secretKey, secrets });
      bound = { connection, knowledge: createCraftAdapter({ connection, backendId, layout: currentLayout }) };
      connections.set(key, bound);
    }
    return { backendId, endpoint, secretKey, connection: bound.connection, knowledge: bound.knowledge, layout: currentLayout };
  }
  // Grants may name any port operation; the capability inventory lists them without I/O.
  const knownOperations = async () => {
    const inventory = await bind(DEFAULT_BACKEND_ID, DEFAULT_CRAFT_ENDPOINT).knowledge.capabilities();
    return inventory.ok ? Object.keys(inventory.value).filter(key => !key.includes(".query.")) : [];
  };
  const control: UserControlPort = createLocalControlAdapter({ root: controlRoot, knownOperations });

  function activeConfiguration(settings: UserSettings): Result<KnowledgeBackendConfiguration> {
    const configuration = settings.knowledgeBackend.configurations.find(entry => entry.id === settings.knowledgeBackend.activeId);
    if (!configuration) return failure("invalid", "Settings select a backend configuration that does not exist.", "Repair settings.json or rerun Setup.");
    if (configuration.adapter !== "craft") return failure("unsupported", `Backend adapter ${configuration.adapter} is not implemented.`, "Select a craft backend configuration.");
    const connection = configuration.connection;
    if (connection.kind !== "mcp" || connection.transport !== "http") return failure("unsupported", "Only MCP over HTTP is implemented for Craft.", "Configure connection.kind mcp with transport http.");
    if (connection.endpoint.kind !== "public-url") return failure("unsupported", "Secret-reference endpoints are not implemented; Craft's MCP endpoint is public.", `Use the public URL ${DEFAULT_CRAFT_ENDPOINT}.`);
    return { ok: true, value: configuration, limits: [] };
  }

  /** The active backend from Settings; knowledge operations require it. */
  async function binding(): Promise<Result<KnowledgeBinding>> {
    const settings = await control.settings.read();
    if (!settings.ok) return settings;
    if (settings.value === null) return failure("unavailable", `GPK is not set up in ${controlRoot}.`, "Call gpk_setup_open and let the user finish onboarding in the browser.");
    const configuration = activeConfiguration(settings.value.value);
    if (!configuration.ok) return configuration;
    const config = configuration.value;
    const connectionConfig = config.connection as { endpoint: { url: string }; credentialsRef?: string };
    return { ok: true, value: bind(config.id, connectionConfig.endpoint.url, connectionConfig.credentialsRef), limits: [] };
  }

  /** Setup and diagnostics work before Settings exist, on the default Craft endpoint. */
  async function setupBinding(): Promise<Result<KnowledgeBinding>> {
    const settings = await control.settings.read();
    if (settings.ok && settings.value !== null) return binding();
    if (!settings.ok && settings.error.code !== "invalid") return settings;
    return { ok: true, value: bind(DEFAULT_BACKEND_ID, DEFAULT_CRAFT_ENDPOINT), limits: settings.ok ? [] : ["Settings are invalid; the default Craft endpoint is used for diagnostics only."] };
  }

  const operations = createOperations({ controlRoot, control, binding, setupBinding });
  const onboarding = createOnboarding({ operations, openBrowser: options.openBrowser ?? openBrowser });
  return {
    operations,
    onboarding,
    async close() {
      await onboarding.close();
      await Promise.all([...connections.values()].map(entry => entry.connection.close().catch(() => undefined)));
    },
  };
}
