import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IssuanceState, NetworkName } from "./types.ts";

const varDir = join(dirname(fileURLToPath(import.meta.url)), "..", "var");

export function statePath(network: NetworkName): string {
  return join(varDir, `${network}-issuance.json`);
}

export function loadState(network: NetworkName): IssuanceState {
  try {
    return JSON.parse(readFileSync(statePath(network), "utf8")) as IssuanceState;
  } catch {
    return { network, updatedAt: new Date(0).toISOString() };
  }
}

export function saveState(state: IssuanceState): void {
  mkdirSync(varDir, { recursive: true });
  const next: IssuanceState = { ...state, updatedAt: new Date().toISOString() };
  writeFileSync(statePath(state.network), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

export function mergeState(network: NetworkName, patch: Partial<IssuanceState>): IssuanceState {
  const next = { ...loadState(network), ...patch, network };
  saveState(next);
  return next;
}
