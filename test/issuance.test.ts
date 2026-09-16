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
  assertFlagPlanNotContradictory,
  buildIssuerAccountSet,
  buildIssuerConfigurationSequence,
  buildIssuerFlagAccountSet,
  buildPndPayment,
  buildPndTrustSet,
  buildRpndAuthorize,
  buildRpndIssuanceCreate,
  buildRpndPayment,
  extractMptIssuanceId,
  isIssuerFlagName,
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

test("buildIssuerAccountSet still defaults to asfDefaultRipple when flag is not passed", () => {
  const tx = buildIssuerAccountSet({ issuerAddress: issuer, config: loadTokenConfig() });
  assert.equal(tx.SetFlag, AccountSetAsfFlags.asfDefaultRipple);
});

test("buildIssuerAccountSet honours an explicit flag override, and null omits any flag", () => {
  const config = loadTokenConfig();
  const overridden = buildIssuerAccountSet({ issuerAddress: issuer, config, flag: "allowTrustLineLocking" });
  assert.equal(overridden.SetFlag, AccountSetAsfFlags.asfAllowTrustLineLocking);

  const omitted = buildIssuerAccountSet({ issuerAddress: issuer, config, flag: null });
  assert.equal(omitted.SetFlag, undefined);
});

test("buildIssuerFlagAccountSet builds a standalone AccountSet for each launch-critical flag", () => {
  const clawback = buildIssuerFlagAccountSet({ issuerAddress: issuer, flag: "allowTrustLineClawback" });
  assert.equal(clawback.TransactionType, "AccountSet");
  assert.equal(clawback.Account, issuer);
  assert.equal(clawback.SetFlag, AccountSetAsfFlags.asfAllowTrustLineClawback);
  assert.equal(clawback.TransferRate, undefined, "flag-only AccountSet carries no other fields");
  assert.equal(clawback.TickSize, undefined);
  assert.equal(clawback.Domain, undefined);

  const noFreeze = buildIssuerFlagAccountSet({ issuerAddress: issuer, flag: "noFreeze" });
  assert.equal(noFreeze.SetFlag, AccountSetAsfFlags.asfNoFreeze);

  const requireAuth = buildIssuerFlagAccountSet({ issuerAddress: issuer, flag: "requireAuth" });
  assert.equal(requireAuth.SetFlag, AccountSetAsfFlags.asfRequireAuth);

  const locking = buildIssuerFlagAccountSet({ issuerAddress: issuer, flag: "allowTrustLineLocking" });
  assert.equal(locking.SetFlag, AccountSetAsfFlags.asfAllowTrustLineLocking);

  const cleared = buildIssuerFlagAccountSet({ issuerAddress: issuer, flag: "allowTrustLineLocking", mode: "clear" });
  assert.equal(cleared.ClearFlag, AccountSetAsfFlags.asfAllowTrustLineLocking);
  assert.equal(cleared.SetFlag, undefined);
});

test("isIssuerFlagName validates flag names from CLI input", () => {
  assert.equal(isIssuerFlagName("allowTrustLineLocking"), true);
  assert.equal(isIssuerFlagName("notAFlag"), false);
});

test("assertFlagPlanNotContradictory refuses clawback + noFreeze together, allows either alone", () => {
  assert.throws(
    () => assertFlagPlanNotContradictory({ clawback: true, noFreeze: true }),
    /mutually exclusive/,
  );
  assert.doesNotThrow(() => assertFlagPlanNotContradictory({ clawback: true }));
  assert.doesNotThrow(() => assertFlagPlanNotContradictory({ noFreeze: true }));
  assert.doesNotThrow(() => assertFlagPlanNotContradictory({}));
});

test("buildIssuerConfigurationSequence orders now-or-never flags before the main AccountSet, then NoFreeze, then locking", () => {
  const config = loadTokenConfig();
  const txs = buildIssuerConfigurationSequence({
    issuerAddress: issuer,
    config,
    domain: "example.com",
    plan: { clawback: true, requireAuth: true, noFreeze: false, allowTrustLineLocking: true },
  });

  assert.equal(txs.length, 4);
  assert.equal(txs[0]?.SetFlag, AccountSetAsfFlags.asfAllowTrustLineClawback);
  assert.equal(txs[1]?.SetFlag, AccountSetAsfFlags.asfRequireAuth);
  assert.equal(txs[2]?.SetFlag, AccountSetAsfFlags.asfDefaultRipple);
  assert.equal(txs[2]?.Domain, Buffer.from("example.com", "utf8").toString("hex").toUpperCase());
  assert.equal(txs[3]?.SetFlag, AccountSetAsfFlags.asfAllowTrustLineLocking);
});

test("buildIssuerConfigurationSequence with an empty plan is just the one main AccountSet", () => {
  const txs = buildIssuerConfigurationSequence({ issuerAddress: issuer, config: loadTokenConfig(), plan: {} });
  assert.equal(txs.length, 1);
  assert.equal(txs[0]?.SetFlag, AccountSetAsfFlags.asfDefaultRipple);
});

test("buildIssuerConfigurationSequence refuses a plan requesting both clawback and noFreeze", () => {
  assert.throws(
    () =>
      buildIssuerConfigurationSequence({
        issuerAddress: issuer,
        config: loadTokenConfig(),
        plan: { clawback: true, noFreeze: true },
      }),
    /mutually exclusive/,
  );
});
