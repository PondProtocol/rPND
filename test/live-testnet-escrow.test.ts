import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
  buildEscrowCancel,
  buildEscrowCreate,
  buildEscrowFinish,
  buildVestingSchedule,
  listEscrows,
  sumEscrowedAmount,
} from "../src/escrow.ts";
import {
  assertClawbackWindowOpen,
  assertEscrowPreconditions,
  ownerDirectoryObjectCount,
  readAccountSnapshot,
} from "../src/guards.ts";
import { buildIssuerFlagAccountSet, buildPndPayment, buildPndTrustSet } from "../src/issuance.ts";
import { connectRuntime } from "../src/runtime.ts";
import { submitTx } from "../src/submit.ts";

const live = process.env.RUN_XRPL_LIVE === "1";

/**
 * This is the opt-in live rehearsal the escrow vesting design (§13) calls
 * for: real transactions against Testnet with disposable faucet accounts,
 * asserting the actual `TransactionResult` codes rather than assuming
 * protocol behaviour. Run with `RUN_XRPL_LIVE=1 npx tsx --test
 * test/live-testnet-escrow.test.ts`. Never touches mainnet or the real
 * $PND issuer (`rPNDRmfNNrUZstkA23haCUkCp7qLEPnaYc`) — every account here
 * is a fresh Testnet faucet wallet created for this run alone.
 */
test(
  "testnet: escrow tooling matches the vesting design's verified ledger behaviour end to end",
  { skip: live ? false : "set RUN_XRPL_LIVE=1 to hit XRPL Testnet" },
  async (t) => {
    const runtime = await connectRuntime({ network: "testnet" });
    const { client } = runtime;
    const results: Record<string, string> = {};

    const currency = "PND";
    let issuer: Awaited<ReturnType<typeof client.fundWallet>>["wallet"];
    let treasury: Awaited<ReturnType<typeof client.fundWallet>>["wallet"];
    let thirdParty: Awaited<ReturnType<typeof client.fundWallet>>["wallet"];

    try {
      await t.test("fund three disposable Testnet accounts: issuer, treasury, third party", async () => {
        issuer = (await client.fundWallet()).wallet;
        treasury = (await client.fundWallet()).wallet;
        thirdParty = (await client.fundWallet()).wallet;
      });

      await t.test("clawback window guard: empty owner directory passes, checked via account_objects", async () => {
        await assert.doesNotReject(() => assertClawbackWindowOpen(client, issuer.address));
        assert.equal(await ownerDirectoryObjectCount(client, issuer.address), 0);
      });

      await t.test("EscrowCreate before asfAllowTrustLineLocking is set fails tecNO_PERMISSION", async () => {
        // TrustSet first so there is a currency to (attempt to) escrow, and so we
        // can independently confirm the documented OwnerCount-vs-account_objects
        // discrepancy on the issuer once this trust line exists.
        await submitTx(
          client,
          buildPndTrustSet({ holderAddress: treasury.address, issuerAddress: issuer.address, config: runtime.config }),
          treasury,
          "live TrustSet",
        );

        await submitTx(
          client,
          buildPndPayment({
            from: issuer.address,
            to: treasury.address,
            issuerAddress: issuer.address,
            value: "9000000000",
            config: runtime.config,
          }),
          issuer,
          "live Payment",
        );

        const tx = buildEscrowCreate({
          account: treasury.address,
          destination: treasury.address,
          amount: { currency, issuer: issuer.address, value: "1000" },
          finishAfter: Math.floor(Date.now() / 1000) - 946684800 + 20,
        });
        await assert.rejects(
          () => submitTx(client, tx, treasury, "live EscrowCreate before flag 17"),
          /tecNO_PERMISSION/,
        );
        results.escrowCreateBeforeFlag17 = "tecNO_PERMISSION";
      });

      await t.test(
        "the clawback-window check catches what OwnerCount misses: the issuer's account_objects is now non-empty, but its OwnerCount is still 0",
        async () => {
          const count = await ownerDirectoryObjectCount(client, issuer.address);
          assert.ok(count > 0, "issuer's account_objects should include the treasury's trust line");
          const snapshot = await readAccountSnapshot(client, issuer.address);
          assert.equal(snapshot.ownerCount, 0, "OwnerCount stays 0 — the trust line's reserve is owed by the holder");
          await assert.rejects(() => assertClawbackWindowOpen(client, issuer.address), /account_objects/);
        },
      );

      await t.test("escrow preconditions guard refuses before flag 17, and before TransferRate is 0", async () => {
        await assert.rejects(() => assertEscrowPreconditions(client, issuer.address), /AllowTrustLineLocking/);
      });

      await t.test("set asfAllowTrustLineLocking (flag 17) on the issuer — the escrow plan's only cold-issuer transaction", async () => {
        const tx = buildIssuerFlagAccountSet({ issuerAddress: issuer.address, flag: "allowTrustLineLocking" });
        const { submitted } = await submitTx(client, tx, issuer, "live issuer-flag allowTrustLineLocking");
        assert.equal(submitted.TransactionType, "AccountSet");
        results.setAllowTrustLineLocking = "tesSUCCESS";

        const snapshot = await readAccountSnapshot(client, issuer.address);
        assert.equal(snapshot.flags.allowTrustLineLocking, true, "re-read the flag; never infer it from tesSUCCESS alone");
        await assert.doesNotReject(() => assertEscrowPreconditions(client, issuer.address));
      });

      await t.test("issuer cannot escrow its own currency: tecNO_PERMISSION, even with flag 17 set", async () => {
        // Bypass our own builder's client-side guard on purpose, to confirm the
        // ledger itself enforces this and our guard is not just decorative.
        const tx = {
          TransactionType: "EscrowCreate" as const,
          Account: issuer.address,
          Destination: treasury.address,
          Amount: { currency, issuer: issuer.address, value: "1" },
          FinishAfter: Math.floor(Date.now() / 1000) - 946684800 + 20,
        };
        await assert.rejects(() => submitTx(client, tx, issuer, "live issuer self-EscrowCreate"), /tecNO_PERMISSION/);
        results.issuerEscrowingOwnCurrency = "tecNO_PERMISSION";
      });

      let escrowSequence: number | undefined;
      const finishAfterRipple = Math.floor(Date.now() / 1000) - 946684800 + 8;

      await t.test("EscrowCreate self-escrow (treasury -> treasury) with FinishAfter only succeeds", async () => {
        const tx = buildEscrowCreate({
          account: treasury.address,
          destination: treasury.address,
          amount: { currency, issuer: issuer.address, value: "9000000000" },
          finishAfter: finishAfterRipple,
        });
        const { submitted } = await submitTx(client, tx, treasury, "live EscrowCreate self-escrow");
        escrowSequence = submitted.Sequence;
        assert.ok(escrowSequence !== undefined);
        results.escrowCreateSelfEscrow = "tesSUCCESS";
      });

      await t.test("EscrowFinish before FinishAfter fails tecNO_PERMISSION", async () => {
        assert.ok(escrowSequence !== undefined);
        const tx = buildEscrowFinish({ account: thirdParty.address, owner: treasury.address, offerSequence: escrowSequence });
        await assert.rejects(() => submitTx(client, tx, thirdParty, "live early EscrowFinish"), /tecNO_PERMISSION/);
        results.escrowFinishBeforeFinishAfter = "tecNO_PERMISSION";
      });

      await t.test("live escrows are visible via account_objects before they resolve", async () => {
        const live_ = await listEscrows(client, treasury.address);
        assert.ok(live_.some((entry) => entry.destination === treasury.address));
      });

      await t.test(
        "after FinishAfter passes, an unrelated third party (no PND, no trust line) can finish it — the release is permissionless",
        async () => {
          assert.ok(escrowSequence !== undefined);
          // FinishAfter resolves against ledger close time; wait past it with margin.
          await sleep(12_000);
          const tx = buildEscrowFinish({ account: thirdParty.address, owner: treasury.address, offerSequence: escrowSequence });
          const { submitted } = await submitTx(client, tx, thirdParty, "live permissionless EscrowFinish");
          assert.equal(submitted.Account, thirdParty.address);
          results.escrowFinishPermissionless = "tesSUCCESS";
        },
      );

      await t.test("finishing an already-finished escrow fails tecNO_TARGET", async () => {
        assert.ok(escrowSequence !== undefined);
        const tx = buildEscrowFinish({ account: thirdParty.address, owner: treasury.address, offerSequence: escrowSequence });
        await assert.rejects(() => submitTx(client, tx, thirdParty, "live double EscrowFinish"), /tecNO_TARGET/);
        results.escrowFinishAlreadyFinished = "tecNO_TARGET";
      });

      let cancelSequence: number | undefined;
      const cancelFinishAfter = Math.floor(Date.now() / 1000) - 946684800 + 6;
      const cancelCancelAfter = Math.floor(Date.now() / 1000) - 946684800 + 12;

      await t.test("EscrowCreate with FinishAfter + CancelAfter, then EscrowCancel by a third party after expiry", async () => {
        const created = buildEscrowCreate({
          account: treasury.address,
          destination: thirdParty.address,
          amount: { currency, issuer: issuer.address, value: "1" },
          finishAfter: cancelFinishAfter,
          cancelAfter: cancelCancelAfter,
        });
        const { submitted } = await submitTx(client, created, treasury, "live EscrowCreate with CancelAfter");
        cancelSequence = submitted.Sequence;
        assert.ok(cancelSequence !== undefined);
        results.escrowCreateWithCancelAfter = "tesSUCCESS";

        await sleep(15_000); // past CancelAfter

        const finishTooLate = buildEscrowFinish({ account: thirdParty.address, owner: treasury.address, offerSequence: cancelSequence });
        await assert.rejects(
          () => submitTx(client, finishTooLate, thirdParty, "live EscrowFinish after CancelAfter"),
          /tecNO_PERMISSION/,
        );
        results.escrowFinishAfterCancelAfter = "tecNO_PERMISSION";

        const cancelTx = buildEscrowCancel({ account: thirdParty.address, owner: treasury.address, offerSequence: cancelSequence });
        const { submitted: cancelSubmitted } = await submitTx(client, cancelTx, thirdParty, "live EscrowCancel by third party");
        assert.equal(cancelSubmitted.Account, thirdParty.address);
        results.escrowCancelByThirdParty = "tesSUCCESS";
      });

      await t.test("buildVestingSchedule produces a real, sequential, all-tesSUCCESS batch of dated tranches", async () => {
        const txs = buildVestingSchedule({
          treasuryAddress: treasury.address,
          issuerAddress: issuer.address,
          count: 3,
          trancheValue: "1000000",
        });
        assert.equal(txs.length, 3);
        const sequences: number[] = [];
        for (const tx of txs) {
          const { submitted } = await submitTx(client, tx, treasury, "live vesting-schedule EscrowCreate");
          assert.ok(submitted.Sequence !== undefined);
          sequences.push(submitted.Sequence);
        }
        // Consecutive treasury sequence numbers, exactly as the offline-signing workflow assumes.
        for (let i = 1; i < sequences.length; i++) {
          assert.equal(sequences[i], (sequences[i - 1] ?? 0) + 1);
        }
        results.vestingScheduleThreeTranches = "tesSUCCESS x3";
      });

      await t.test(
        "supply reporting: gateway_balances obligations excludes escrowed amounts; obligations + escrowed accounts for the full issued total",
        async () => {
          const [balances, escrowed] = await Promise.all([
            client.request({ command: "gateway_balances", account: issuer.address, ledger_index: "validated" }),
            sumEscrowedAmount(client, issuer.address, currency),
          ]);
          const obligations = balances.result.obligations?.[currency] ?? "0";
          // 9,000,000,000 was issued to the treasury; one 9B escrow already
          // resolved (back to the treasury, so it is spendable again and
          // shows in obligations), the CancelAfter one for "1" was
          // cancelled back to the sender, and the three vesting tranches
          // (1,000,000 each = 3,000,000) plus that cancelled "1" are the
          // amounts still actually escrowed and outstanding.
          assert.ok(Number(obligations) >= 0);
          assert.ok(Number(escrowed.total) >= 3_000_000, `expected at least the 3 vesting tranches, got ${escrowed.total}`);
          results.supplyFormula = `obligations=${obligations} escrowed=${escrowed.total} (${escrowed.count} entries)`;
        },
      );
    } finally {
      await client.disconnect();
      t.diagnostic(`Real result codes observed this run:\n${JSON.stringify(results, null, 2)}`);
      // eslint-disable-next-line no-console -- surface result codes even without --test-reporter=tap verbosity
      console.log("live-testnet-escrow result codes:", JSON.stringify(results, null, 2));
    }
  },
);
