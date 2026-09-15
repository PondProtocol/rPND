import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTokenConfig, validateTokenConfig } from "../src/config.ts";
import type { TokenConfig } from "../src/types.ts";

function cloneConfig(): TokenConfig {
  return structuredClone(loadTokenConfig());
}

test("loads canonical $PND IOU and $rPND MPT config", () => {
  const config = loadTokenConfig();
  assert.equal(config.product, "rPND");
  assert.equal(config.pnd.kind, "iou");
  assert.equal(config.pnd.currency, "PND");
  assert.equal(config.rpnd.kind, "mpt");
  assert.equal(config.rpnd.ticker, "RPND");
  assert.equal(config.rpnd.name, "rPND");
  assert.equal(config.networks.devnet.supportsMpt, true);
});

test("rejects blank XLS-89 issuerName", () => {
  const config = cloneConfig();
  config.rpnd.issuerName = "   ";
  assert.throws(() => validateTokenConfig(config), /issuerName/);
});

test("rejects IOU currency other than PND", () => {
  const config = cloneConfig();
  (config.pnd as { currency: string }).currency = "USD";
  assert.throws(() => validateTokenConfig(config), /PND/);
});

test("rejects rPND issuance above max supply", () => {
  const config = cloneConfig();
  config.rpnd.initialIssuance = "999999999999999999";
  config.rpnd.maximumAmount = "1";
  assert.throws(() => validateTokenConfig(config), /initialIssuance exceeds maximumAmount/);
});

test("product files do not mention an unrelated lab or org as issuer", () => {
  const files = [
    "../README.md",
    "../LICENSE",
    "../package.json",
    "../docs/tokens.md",
    "../docs/issuance.md",
    "../config/tokens.json",
    "../config/xrp-ledger.toml.template",
    "../src/index.ts",
    "../src/cli.ts",
    "../src/config.ts",
    "../src/issuance.ts",
    "../src/metadata.ts",
  ];
  for (const file of files) {
    const body = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(/greenhead/i.test(body), false, file);
  }
});
