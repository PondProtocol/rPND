import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Client, SubmittableTransaction, TransactionMetadata, Wallet } from "xrpl";
import { assertTesSuccess } from "./issuance.ts";

const varDir = join(dirname(fileURLToPath(import.meta.url)), "..", "var");

export async function submitTx(
  client: Client,
  tx: SubmittableTransaction,
  wallet: Wallet,
  label: string,
): Promise<{
  hash: string;
  meta: TransactionMetadata | string | undefined;
  /** The transaction as actually signed and submitted — has the real Sequence, Fee, etc. `tx` passed in is never mutated. */
  submitted: SubmittableTransaction;
}> {
  const response = await client.submitAndWait(tx, { wallet, autofill: true });
  const meta = response.result.meta;
  const result =
    meta && typeof meta === "object" && "TransactionResult" in meta
      ? meta.TransactionResult
      : undefined;
  assertTesSuccess(result, label);
  return { hash: response.result.hash, meta, submitted: response.result.tx_json };
}

export function writeSecretsFile(
  network: string,
  secrets: Record<string, string>,
): string {
  mkdirSync(varDir, { recursive: true });
  const path = join(varDir, `${network}-wallets.json`);
  writeFileSync(path, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  return path;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

export function requireArg(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}
