import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "xrpl";
import { connectRuntime } from "../src/runtime.ts";
import {
  buildIssuerAccountSet,
  buildPndPayment,
  buildPndTrustSet,
  buildRpndAuthorize,
  buildRpndIssuanceCreate,
  buildRpndPayment,
  extractMptIssuanceId,
} from "../src/issuance.ts";
import { submitTx } from "../src/submit.ts";

const live = process.env.RUN_XRPL_LIVE === "1";

test(
  "devnet faucet can issue $PND and create $rPND",
  { skip: live ? false : "set RUN_XRPL_LIVE=1 to hit XRPL Devnet" },
  async () => {
    const runtime = await connectRuntime({ network: "devnet" });
    try {
      assert.equal(runtime.config.networks.devnet.supportsMpt, true);
      const issuer = (await runtime.client.fundWallet()).wallet;
      const operational = (await runtime.client.fundWallet()).wallet;
      assert.ok(Wallet.fromSeed(issuer.seed ?? "").address);

      await submitTx(
        runtime.client,
        buildIssuerAccountSet({
          issuerAddress: issuer.address,
          config: runtime.config,
        }),
        issuer,
        "live configure-issuer",
      );

      await submitTx(
        runtime.client,
        buildPndTrustSet({
          holderAddress: operational.address,
          issuerAddress: issuer.address,
          config: runtime.config,
        }),
        operational,
        "live pnd TrustSet",
      );

      await submitTx(
        runtime.client,
        buildPndPayment({
          from: issuer.address,
          to: operational.address,
          issuerAddress: issuer.address,
          value: "100",
          config: runtime.config,
        }),
        issuer,
        "live pnd Payment",
      );

      const created = await submitTx(
        runtime.client,
        buildRpndIssuanceCreate({
          issuerAddress: issuer.address,
          config: runtime.config,
        }),
        issuer,
        "live rPND create",
      );
      const issuanceId = extractMptIssuanceId(created.meta);
      assert.ok(issuanceId, "expected mpt_issuance_id");

      await submitTx(
        runtime.client,
        buildRpndAuthorize({ holderAddress: operational.address, issuanceId }),
        operational,
        "live rPND authorize",
      );

      await submitTx(
        runtime.client,
        buildRpndPayment({
          from: issuer.address,
          to: operational.address,
          issuanceId,
          value: "50",
        }),
        issuer,
        "live rPND mint",
      );
    } finally {
      await runtime.client.disconnect();
    }
  },
);
