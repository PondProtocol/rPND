import { Client, Wallet } from "xrpl";
import { loadTokenConfig, resolveNetwork } from "./config.ts";
import type { NetworkName, TokenConfig } from "./types.ts";

export interface Runtime {
  config: TokenConfig;
  network: NetworkName;
  websocket: string;
  client: Client;
}

export function readEnvNetwork(): { network: string; websocket?: string } {
  const websocket = process.env.XRPL_WSS;
  return websocket
    ? { network: process.env.XRPL_NETWORK ?? "devnet", websocket }
    : { network: process.env.XRPL_NETWORK ?? "devnet" };
}

export async function connectRuntime(overrides?: {
  network?: string;
  websocket?: string;
}): Promise<Runtime> {
  const config = loadTokenConfig();
  const env = readEnvNetwork();
  const resolved = resolveNetwork(
    config,
    overrides?.network ?? env.network,
    overrides?.websocket ?? env.websocket,
  );
  const client = new Client(resolved.websocket);
  await client.connect();
  return { config, network: resolved.name, websocket: resolved.websocket, client };
}

export function walletFromSeed(seed: string | undefined, role: string): Wallet {
  if (!seed?.trim()) {
    throw new Error(`Missing ${role} seed. Set the env var or pass --${role}-seed.`);
  }
  return Wallet.fromSeed(seed.trim());
}

export function optionalWallet(seed: string | undefined): Wallet | undefined {
  if (!seed?.trim()) return undefined;
  return Wallet.fromSeed(seed.trim());
}

export async function withRuntime<T>(
  fn: (runtime: Runtime) => Promise<T>,
  overrides?: { network?: string; websocket?: string },
): Promise<T> {
  const runtime = await connectRuntime(overrides);
  try {
    return await fn(runtime);
  } finally {
    await runtime.client.disconnect();
  }
}
