import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EscrowRecord, IssuanceState, NetworkName } from "./types.ts";

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

/**
 * Append a newly-created escrow's record — most importantly its
 * `Sequence`, needed as the `OfferSequence` for the `EscrowFinish` that
 * releases it, possibly months later. Idempotent on `(owner, offerSequence)`
 * so re-running a script that reports an already-recorded escrow does not
 * duplicate it.
 */
export function recordEscrow(network: NetworkName, record: EscrowRecord): IssuanceState {
  const state = loadState(network);
  const existing = state.escrows ?? [];
  const withoutDuplicate = existing.filter(
    (entry) => !(entry.owner === record.owner && entry.offerSequence === record.offerSequence),
  );
  return mergeState(network, { escrows: [...withoutDuplicate, record] });
}

export function updateEscrowStatus(
  network: NetworkName,
  owner: string,
  offerSequence: number,
  status: EscrowRecord["status"],
): IssuanceState {
  const state = loadState(network);
  const escrows = (state.escrows ?? []).map((entry) =>
    entry.owner === owner && entry.offerSequence === offerSequence ? { ...entry, status } : entry,
  );
  return mergeState(network, { escrows });
}

export function listRecordedEscrows(network: NetworkName, owner?: string): EscrowRecord[] {
  const escrows = loadState(network).escrows ?? [];
  return owner ? escrows.filter((entry) => entry.owner === owner) : escrows;
}
