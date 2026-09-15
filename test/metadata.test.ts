import assert from "node:assert/strict";
import test from "node:test";
import { decodeMPTokenMetadata } from "xrpl";
import { loadTokenConfig } from "../src/config.ts";
import { encodeRpndMetadata, renderXrpLedgerToml, rpndMetadata } from "../src/metadata.ts";

test("XLS-89 metadata encodes under the 1024-byte cap and round-trips", () => {
  const hex = encodeRpndMetadata();
  assert.equal(hex.length % 2, 0);
  assert.ok(hex.length / 2 <= 1024);
  const decoded = decodeMPTokenMetadata(hex);
  assert.equal(decoded.ticker, "RPND");
  assert.equal(decoded.name, "rPND");
  assert.equal(decoded.asset_class, "other");
  assert.equal(decoded.issuer_name, "rPND");
});

test("rPND metadata records the paired $PND IOU", () => {
  const meta = rpndMetadata();
  assert.equal((meta.additional_info as { paired_iou_currency?: string }).paired_iou_currency, "PND");
});

test("xrp-ledger.toml names $PND as an IOU and leaves $rPND issuance id substitutable", () => {
  const toml = renderXrpLedgerToml({
    issuerAddress: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
    issuerDomain: "example.com",
    network: "devnet",
    rpndIssuanceId: "AABBCC",
  });
  assert.match(toml, /currency = "PND"/);
  assert.match(toml, /rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe/);
  assert.match(toml, /network = "devnet"/);
  assert.match(toml, /AABBCC/);
  assert.doesNotMatch(toml, /\{\{ISSUER_ADDRESS\}\}/);
});

test("loaded config is the source of encoded ticker and currency", () => {
  const config = loadTokenConfig();
  const meta = rpndMetadata(config);
  assert.equal(meta.ticker, config.rpnd.ticker);
  assert.equal(config.pnd.currency, "PND");
});
