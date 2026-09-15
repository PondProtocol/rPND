import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountSetAsfFlags,
  AccountSetTfFlags,
  MPTokenIssuanceCreateFlags,
  MPTokenIssuanceCreateImmutableFlags,
} from "xrpl";
import { loadTokenConfig } from "../src/config.ts";
import {
  buildIssuerAccountSet,
  buildPndPayment,
  buildPndTrustSet,
  buildRpndAuthorize,
  buildRpndIssuanceCreate,
  buildRpndPayment,
  extractMptIssuanceId,
  mptCreateFlags,
} from "../src/issuance.ts";

const issuer = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
const hot = "rpPNDHotWalletAddressPlaceholderXXXX";

test("issuer AccountSet enables DefaultRipple and DisallowXRP for $PND", () => {
  const tx = buildIssuerAccountSet({
    issuerAddress: issuer,
    config: loadTokenConfig(),
    domain: "example.com",
  });
  assert.equal(tx.TransactionType, "AccountSet");
  assert.equal(tx.SetFlag, AccountSetAsfFlags.asfDefaultRipple);
  assert.equal((Number(tx.Flags) & AccountSetTfFlags.tfDisallowXRP) !== 0, true);
  assert.equal(tx.Domain, Buffer.from("example.com", "utf8").toString("hex").toUpperCase());
  assert.equal(tx.TickSize, 5);
  assert.equal(tx.TransferRate, 0);
});

test("$PND TrustSet and Payment use currency PND and the cold issuer", () => {
  const config = loadTokenConfig();
  const trust = buildPndTrustSet({ holderAddress: hot, issuerAddress: issuer, config });
  assert.equal(trust.TransactionType, "TrustSet");
  assert.equal(trust.LimitAmount.currency, "PND");
  assert.equal(trust.LimitAmount.issuer, issuer);

  const payment = buildPndPayment({
    from: issuer,
    to: hot,
    issuerAddress: issuer,
    value: "42",
    config,
  });
  assert.equal(payment.TransactionType, "Payment");
  assert.equal(typeof payment.Amount, "object");
  const amount = payment.Amount as { currency: string; issuer: string; value: string };
  assert.equal(amount.currency, "PND");
  assert.equal(amount.issuer, issuer);
  assert.equal(amount.value, "42");
});

test("$rPND issuance create sets transfer + lock, forbids clawback permanently, and attaches metadata", () => {
  const config = loadTokenConfig();
  const tx = buildRpndIssuanceCreate({ issuerAddress: issuer, config });
  assert.equal(tx.TransactionType, "MPTokenIssuanceCreate");
  assert.equal(tx.AssetScale, 6);
  assert.equal(tx.MaximumAmount, config.rpnd.maximumAmount);
  assert.equal(typeof tx.MPTokenMetadata, "string");
  assert.ok((tx.MPTokenMetadata as string).length > 0);
  const flags = Number(tx.Flags);
  assert.equal((flags & MPTokenIssuanceCreateFlags.tfMPTCanTransfer) !== 0, true);
  assert.equal((flags & MPTokenIssuanceCreateFlags.tfMPTCanLock) !== 0, true);
  assert.equal((flags & MPTokenIssuanceCreateFlags.tfMPTCanClawback) !== 0, false);
  assert.equal(tx.ImmutableFlags, MPTokenIssuanceCreateImmutableFlags.tifMPTCanClawback);
});

test("$rPND authorize and payment use mpt_issuance_id amounts", () => {
  const issuanceId = "00112233445566778899AABBCCDDEEFF0011223344556677";
  const authorize = buildRpndAuthorize({ holderAddress: hot, issuanceId });
  assert.equal(authorize.TransactionType, "MPTokenAuthorize");
  assert.equal(authorize.MPTokenIssuanceID, issuanceId);

  const payment = buildRpndPayment({
    from: issuer,
    to: hot,
    issuanceId,
    value: "100",
  });
  const amount = payment.Amount as { mpt_issuance_id: string; value: string };
  assert.equal(amount.mpt_issuance_id, issuanceId);
  assert.equal(amount.value, "100");
});

test("extractMptIssuanceId reads meta.mpt_issuance_id and CreatedNode fallback", () => {
  assert.equal(
    extractMptIssuanceId({
      TransactionIndex: 0,
      TransactionResult: "tesSUCCESS",
      AffectedNodes: [],
      mpt_issuance_id: "ABCDEF",
    } as never),
    "ABCDEF",
  );
  assert.equal(
    extractMptIssuanceId({
      TransactionIndex: 0,
      TransactionResult: "tesSUCCESS",
      AffectedNodes: [
        {
          CreatedNode: {
            LedgerEntryType: "MPTokenIssuance",
            LedgerIndex: "00",
            NewFields: { mpt_issuance_id: "FROMNODE" },
          },
        },
      ],
    }),
    "FROMNODE",
  );
});

test("mptCreateFlags follows config booleans", () => {
  const config = loadTokenConfig();
  config.rpnd.flags.canTrade = true;
  const flags = mptCreateFlags(config);
  assert.equal((flags & MPTokenIssuanceCreateFlags.tfMPTCanTrade) !== 0, true);
});
