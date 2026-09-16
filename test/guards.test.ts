import assert from "node:assert/strict";
import test from "node:test";
import { LedgerEntry } from "xrpl";
import {
  assertClawbackWindowOpen,
  assertEscrowPreconditions,
  assertFlagNotAlreadyContradicted,
  assertFlagsNotContradictory,
  decodeIssuerFlagState,
  hasIssuerFlag,
  ownerDirectoryIsEmpty,
  ownerDirectoryObjectCount,
  readAccountSnapshot,
} from "../src/guards.ts";

const { AccountRootFlags } = LedgerEntry;

/** A minimal stand-in for xrpl.Client that only implements `.request`. */
function fakeClient(handlers: {
  accountInfo?: (params: unknown) => unknown;
  accountObjects?: (params: unknown) => unknown;
}) {
  return {
    async request(params: { command: string } & Record<string, unknown>) {
      if (params.command === "account_info" && handlers.accountInfo) {
        return { result: handlers.accountInfo(params) };
      }
      if (params.command === "account_objects" && handlers.accountObjects) {
        return { result: handlers.accountObjects(params) };
      }
      throw new Error(`fakeClient: unhandled command ${params.command}`);
    },
    // biome-ignore lint: cast to the xrpl Client shape our guard functions actually use
  } as unknown as import("xrpl").Client;
}

function accountData(flags: number, extra: Record<string, unknown> = {}) {
  return { account_data: { Flags: flags, OwnerCount: 0, TransferRate: 0, ...extra } };
}

test("decodeIssuerFlagState / hasIssuerFlag decode the AccountRoot Flags bitmask", () => {
  const bits = AccountRootFlags.lsfDefaultRipple | AccountRootFlags.lsfAllowTrustLineLocking;
  const state = decodeIssuerFlagState(bits);
  assert.equal(state.defaultRipple, true);
  assert.equal(state.allowTrustLineLocking, true);
  assert.equal(state.noFreeze, false);
  assert.equal(state.allowTrustLineClawback, false);
  assert.equal(hasIssuerFlag(state, "allowTrustLineLocking"), true);
  assert.equal(hasIssuerFlag(state, "noFreeze"), false);
});

test("assertFlagsNotContradictory refuses clawback + noFreeze together", () => {
  assert.throws(() => assertFlagsNotContradictory({ clawback: true, noFreeze: true }), /mutually exclusive/);
  assert.doesNotThrow(() => assertFlagsNotContradictory({ clawback: true }));
});

test("ownerDirectoryObjectCount / ownerDirectoryIsEmpty read account_objects, not OwnerCount", async () => {
  const empty = fakeClient({ accountObjects: () => ({ account_objects: [] }) });
  assert.equal(await ownerDirectoryObjectCount(empty, "rIssuer"), 0);
  assert.equal(await ownerDirectoryIsEmpty(empty, "rIssuer"), true);

  // The documented trap: a trust line links into the issuer's account_objects
  // while its own OwnerCount (not queried by this function at all) stays 0.
  const withTrustLine = fakeClient({
    accountObjects: () => ({ account_objects: [{ LedgerEntryType: "RippleState" }] }),
  });
  assert.equal(await ownerDirectoryObjectCount(withTrustLine, "rIssuer"), 1);
  assert.equal(await ownerDirectoryIsEmpty(withTrustLine, "rIssuer"), false);
});

test("ownerDirectoryObjectCount paginates through account_objects markers", async () => {
  let calls = 0;
  const client = fakeClient({
    accountObjects: () => {
      calls += 1;
      return calls === 1
        ? { account_objects: [{ LedgerEntryType: "RippleState" }], marker: "page2" }
        : { account_objects: [{ LedgerEntryType: "Escrow" }] };
    },
  });
  assert.equal(await ownerDirectoryObjectCount(client, "rIssuer"), 2);
  assert.equal(calls, 2);
});

test("assertClawbackWindowOpen passes on an empty directory and throws on a non-empty one", async () => {
  const empty = fakeClient({ accountObjects: () => ({ account_objects: [] }) });
  await assert.doesNotReject(() => assertClawbackWindowOpen(empty, "rIssuer"));

  const nonEmpty = fakeClient({
    accountObjects: () => ({ account_objects: [{ LedgerEntryType: "RippleState" }] }),
  });
  await assert.rejects(() => assertClawbackWindowOpen(nonEmpty, "rIssuer"), /account_objects/);
});

test("readAccountSnapshot decodes flags, TransferRate, and OwnerCount from one account_info call", async () => {
  const client = fakeClient({
    accountInfo: () => accountData(AccountRootFlags.lsfNoFreeze, { TransferRate: 1005000000, OwnerCount: 3 }),
  });
  const snapshot = await readAccountSnapshot(client, "rIssuer");
  assert.equal(snapshot.flags.noFreeze, true);
  assert.equal(snapshot.transferRate, 1005000000);
  assert.equal(snapshot.ownerCount, 3);
});

test("assertFlagNotAlreadyContradicted refuses clawback when NoFreeze is already live, and vice versa", async () => {
  const noFreezeAlreadySet = fakeClient({ accountInfo: () => accountData(AccountRootFlags.lsfNoFreeze) });
  await assert.rejects(
    () => assertFlagNotAlreadyContradicted(noFreezeAlreadySet, "rIssuer", "allowTrustLineClawback"),
    /mutually exclusive/,
  );

  const clawbackAlreadySet = fakeClient({
    accountInfo: () => accountData(AccountRootFlags.lsfAllowTrustLineClawback),
  });
  await assert.rejects(
    () => assertFlagNotAlreadyContradicted(clawbackAlreadySet, "rIssuer", "noFreeze"),
    /mutually exclusive/,
  );

  const neitherSet = fakeClient({ accountInfo: () => accountData(0) });
  await assert.doesNotReject(() => assertFlagNotAlreadyContradicted(neitherSet, "rIssuer", "allowTrustLineClawback"));
});

test("assertEscrowPreconditions refuses without allowTrustLineLocking, and without TransferRate 0", async () => {
  const noLocking = fakeClient({ accountInfo: () => accountData(0) });
  await assert.rejects(() => assertEscrowPreconditions(noLocking, "rIssuer"), /AllowTrustLineLocking/);

  const nonZeroRate = fakeClient({
    accountInfo: () => accountData(AccountRootFlags.lsfAllowTrustLineLocking, { TransferRate: 1005000000 }),
  });
  await assert.rejects(() => assertEscrowPreconditions(nonZeroRate, "rIssuer"), /TransferRate/);

  const ready = fakeClient({
    accountInfo: () => accountData(AccountRootFlags.lsfAllowTrustLineLocking, { TransferRate: 0 }),
  });
  await assert.doesNotReject(() => assertEscrowPreconditions(ready, "rIssuer"));
});
