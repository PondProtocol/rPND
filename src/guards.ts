import { LedgerEntry, type Client } from "xrpl";
import type { IssuerFlagName } from "./issuance.ts";

const { AccountRootFlags } = LedgerEntry;

/**
 * Decoded `AccountRoot.Flags` bits for the flags this toolkit cares about.
 * Read directly from the ledger object's `Flags` bitmask rather than the
 * `account_info` `account_flags` convenience object, because that
 * convenience object is a manually maintained parallel structure in
 * xrpl.js and has historically lagged newer flags (e.g. `allowTrustLineLocking`
 * is absent from it in xrpl 5.2.0's type definitions, even though the bit
 * itself has been in `AccountRootFlags` for a while).
 */
export interface IssuerFlagState {
  defaultRipple: boolean;
  requireAuth: boolean;
  noFreeze: boolean;
  allowTrustLineClawback: boolean;
  allowTrustLineLocking: boolean;
  raw: number;
}

const ROOT_FLAG_BY_NAME: Record<IssuerFlagName, LedgerEntry.AccountRootFlags> = {
  defaultRipple: AccountRootFlags.lsfDefaultRipple,
  requireAuth: AccountRootFlags.lsfRequireAuth,
  noFreeze: AccountRootFlags.lsfNoFreeze,
  allowTrustLineClawback: AccountRootFlags.lsfAllowTrustLineClawback,
  allowTrustLineLocking: AccountRootFlags.lsfAllowTrustLineLocking,
};

export function decodeIssuerFlagState(flagsBitmap: number): IssuerFlagState {
  return {
    defaultRipple: (flagsBitmap & AccountRootFlags.lsfDefaultRipple) !== 0,
    requireAuth: (flagsBitmap & AccountRootFlags.lsfRequireAuth) !== 0,
    noFreeze: (flagsBitmap & AccountRootFlags.lsfNoFreeze) !== 0,
    allowTrustLineClawback: (flagsBitmap & AccountRootFlags.lsfAllowTrustLineClawback) !== 0,
    allowTrustLineLocking: (flagsBitmap & AccountRootFlags.lsfAllowTrustLineLocking) !== 0,
    raw: flagsBitmap,
  };
}

export interface AccountSnapshot {
  flags: IssuerFlagState;
  transferRate: number;
  ownerCount: number;
}

/** One `account_info` round trip, decoded for every guard below. */
export async function readAccountSnapshot(client: Client, account: string): Promise<AccountSnapshot> {
  const response = await client.request({
    command: "account_info",
    account,
    ledger_index: "validated",
  });
  const data = response.result.account_data;
  return {
    flags: decodeIssuerFlagState(data.Flags),
    transferRate: data.TransferRate ?? 0,
    ownerCount: data.OwnerCount,
  };
}

export function hasIssuerFlag(state: IssuerFlagState, flag: IssuerFlagName): boolean {
  return (state.raw & ROOT_FLAG_BY_NAME[flag]) !== 0;
}

/**
 * The number of objects in `account_objects` — the correct test for the
 * clawback/RequireAuth "empty owner directory" precondition. `OwnerCount`
 * is the wrong number here: a holder's trust line (or an escrow of this
 * issuer's currency) closes the window while leaving the issuer's own
 * `OwnerCount` at 0, because the reserve for those objects is owed by
 * someone else. Paginates fully so a partial first page never under-counts.
 */
export async function ownerDirectoryObjectCount(client: Client, account: string): Promise<number> {
  let count = 0;
  let marker: unknown;
  do {
    const response = await client.request({
      command: "account_objects",
      account,
      ledger_index: "validated",
      limit: 400,
      ...(marker !== undefined ? { marker } : {}),
    });
    count += response.result.account_objects.length;
    marker = response.result.marker;
  } while (marker !== undefined);
  return count;
}

export async function ownerDirectoryIsEmpty(client: Client, account: string): Promise<boolean> {
  return (await ownerDirectoryObjectCount(client, account)) === 0;
}

/**
 * Refuse to plan `asfAllowTrustLineClawback` and `asfNoFreeze` together.
 * They are permanently mutually exclusive on the same account — enabling
 * one forecloses the other with `tecNO_PERMISSION` — so a caller-chosen
 * configuration must never request both, before any network call.
 */
export function assertFlagsNotContradictory(plan: { clawback?: boolean; noFreeze?: boolean }): void {
  if (plan.clawback && plan.noFreeze) {
    throw new Error(
      "asfAllowTrustLineClawback and asfNoFreeze are permanently mutually exclusive on the same account " +
        "(enabling one forecloses the other with tecNO_PERMISSION). Refusing to build a configuration that requests both.",
    );
  }
}

/**
 * Live check before submitting `asfAllowTrustLineClawback`: the owner
 * directory must be empty, checked with `account_objects`, never
 * `OwnerCount`. The clawback window closes the moment *any* owner-directory
 * object exists — a trust line, an escrow of this account's currency, an
 * offer, a signer list, and so on — even though several of those leave the
 * issuer's own `OwnerCount` at 0.
 */
export async function assertClawbackWindowOpen(client: Client, issuerAddress: string): Promise<void> {
  const count = await ownerDirectoryObjectCount(client, issuerAddress);
  if (count > 0) {
    throw new Error(
      `Refusing to build asfAllowTrustLineClawback for ${issuerAddress}: account_objects returned ${count} ` +
        "entries, so the owner directory is not empty and the clawback window is closed for good. " +
        "(Checked with account_objects, not OwnerCount: a trust line or an escrow of this account's currency " +
        "closes this window while leaving OwnerCount at 0.)",
    );
  }
}

/**
 * Live check before submitting `asfAllowTrustLineClawback` or `asfNoFreeze`:
 * refuse if the *other* one is already set on the live account, even if the
 * caller's own plan did not request both (e.g. a prior run already set one).
 */
export async function assertFlagNotAlreadyContradicted(
  client: Client,
  issuerAddress: string,
  requesting: "allowTrustLineClawback" | "noFreeze",
): Promise<void> {
  const { flags } = await readAccountSnapshot(client, issuerAddress);
  if (requesting === "allowTrustLineClawback" && flags.noFreeze) {
    throw new Error(
      `Refusing to build asfAllowTrustLineClawback for ${issuerAddress}: asfNoFreeze is already set on this ` +
        "account, and the two are permanently mutually exclusive.",
    );
  }
  if (requesting === "noFreeze" && flags.allowTrustLineClawback) {
    throw new Error(
      `Refusing to build asfNoFreeze for ${issuerAddress}: asfAllowTrustLineClawback is already set on this ` +
        "account, and the two are permanently mutually exclusive.",
    );
  }
}

/**
 * The two live preconditions §7b/§9.3 of the escrow design require before
 * any `EscrowCreate` of an issued currency: the issuer has
 * `asfAllowTrustLineLocking` set (or every escrow fails `tecNO_PERMISSION`),
 * and `TransferRate` reads exactly 0 (it is snapshotted into each escrow at
 * creation and silently corrupts tranche amounts otherwise).
 */
export async function assertEscrowPreconditions(client: Client, issuerAddress: string): Promise<void> {
  const snapshot = await readAccountSnapshot(client, issuerAddress);
  if (!snapshot.flags.allowTrustLineLocking) {
    throw new Error(
      `Issuer ${issuerAddress} does not have asfAllowTrustLineLocking set. Every EscrowCreate of its issued ` +
        'currency fails with tecNO_PERMISSION until `issuer-flag --flag allow-trust-line-locking` succeeds.',
    );
  }
  if (snapshot.transferRate !== 0) {
    throw new Error(
      `Issuer ${issuerAddress} has TransferRate ${snapshot.transferRate}, not 0. TransferRate is snapshotted ` +
        "into each escrow at creation and corrupts tranche amounts unless it is exactly 0. Set TransferRate to " +
        "0 on the issuer before creating any escrow of its currency.",
    );
  }
}
