import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function runCli(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

test("cli help lists both tokens", () => {
  const { stdout, status } = runCli(["help"]);
  assert.equal(status, 0);
  assert.match(stdout, /\$PND/);
  assert.match(stdout, /\$rPND/);
  assert.match(stdout, /IOU/);
  assert.match(stdout, /MPT/);
});

test("cli encode-metadata prints RPND hex", () => {
  const { stdout, status } = runCli(["encode-metadata"]);
  assert.equal(status, 0);
  assert.match(stdout, /"ticker": "RPND"/);
  assert.match(stdout, /^hex=[0-9A-F]+$/m);
});

test("cli dry-run prints unsigned PND and rPND transactions", () => {
  const { stdout, status } = runCli(["dry-run"]);
  assert.equal(status, 0, stdout);
  const txs = JSON.parse(stdout) as {
    pndPayment: { Amount: { currency: string } };
    rpndCreate: { TransactionType: string };
  };
  assert.equal(txs.pndPayment.Amount.currency, "PND");
  assert.equal(txs.rpndCreate.TransactionType, "MPTokenIssuanceCreate");
});
