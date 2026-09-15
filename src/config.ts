import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NetworkName, TokenConfig } from "./types.ts";
import { NETWORK_NAMES } from "./types.ts";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export function configPath(): string {
  return join(rootDir, "config", "tokens.json");
}

export function tomlTemplatePath(): string {
  return join(rootDir, "config", "xrp-ledger.toml.template");
}

export function loadTokenConfig(path = configPath()): TokenConfig {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as TokenConfig;
  return validateTokenConfig(parsed);
}

export function validateTokenConfig(config: TokenConfig): TokenConfig {
  const errors: string[] = [];

  if (config.product !== "rPND") {
    errors.push(`product must be "rPND", got ${JSON.stringify(config.product)}`);
  }

  for (const name of NETWORK_NAMES) {
    const network = config.networks[name];
    if (!network?.websocket?.startsWith("wss://")) {
      errors.push(`networks.${name}.websocket must be a wss:// URL`);
    }
  }

  const { pnd, rpnd } = config;

  if (pnd.kind !== "iou" || pnd.currency !== "PND") {
    errors.push("$PND must be an IOU with currency code PND");
  }
  if (!/^[A-Z]{3}$/.test(pnd.currency)) {
    errors.push("PND currency must be a 3-character XRPL code");
  }
  if (pnd.tickSize < 3 || pnd.tickSize > 15) {
    errors.push("PND tickSize must be 3–15");
  }
  if (pnd.transferRate !== 0 && (pnd.transferRate < 1_000_000_000 || pnd.transferRate > 2_000_000_000)) {
    errors.push("PND transferRate must be 0 (no fee) or 1_000_000_000–2_000_000_000");
  }
  if (!isPositiveDecimal(pnd.operationalTrustLimit) || !isPositiveDecimal(pnd.initialIssuance)) {
    errors.push("PND operationalTrustLimit and initialIssuance must be positive decimal strings");
  }

  if (rpnd.kind !== "mpt" || rpnd.ticker !== "RPND") {
    errors.push("$rPND must be an MPT with ticker RPND");
  }
  if (!/^[A-Z0-9]{1,6}$/.test(rpnd.ticker)) {
    errors.push("rPND ticker must be 1–6 uppercase letters or digits");
  }
  if (rpnd.assetScale < 0 || rpnd.assetScale > 19) {
    errors.push("rPND assetScale must be 0–19");
  }
  if (rpnd.transferFee < 0 || rpnd.transferFee > 50_000) {
    errors.push("rPND transferFee must be 0–50000 (0.000%–50.000%)");
  }
  if (rpnd.transferFee > 0 && !rpnd.flags.canTransfer) {
    errors.push("rPND transferFee requires flags.canTransfer");
  }
  if (!isUnsignedInteger(rpnd.maximumAmount) || !isUnsignedInteger(rpnd.initialIssuance)) {
    errors.push("rPND maximumAmount and initialIssuance must be unsigned integer strings");
  }
  if (BigInt(rpnd.initialIssuance) > BigInt(rpnd.maximumAmount)) {
    errors.push("rPND initialIssuance exceeds maximumAmount");
  }
  if (!rpnd.icon.trim()) {
    errors.push("rPND icon is required by XLS-89");
  }
  if (!rpnd.issuerName.trim()) {
    errors.push("rPND issuerName is required by XLS-89");
  }
  const allowedAsset = new Set(["rwa", "memes", "wrapped", "gaming", "defi", "other"]);
  if (!allowedAsset.has(pnd.assetClass) || !allowedAsset.has(rpnd.assetClass)) {
    errors.push("assetClass must be one of rwa, memes, wrapped, gaming, defi, other");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid token config:\n- ${errors.join("\n- ")}`);
  }

  return config;
}

export function resolveNetwork(
  config: TokenConfig,
  name: string,
  websocketOverride?: string,
): { name: NetworkName; websocket: string } {
  if (!NETWORK_NAMES.includes(name as NetworkName)) {
    throw new Error(`Unknown network "${name}". Use ${NETWORK_NAMES.join(", ")}.`);
  }
  const networkName = name as NetworkName;
  return {
    name: networkName,
    websocket: websocketOverride ?? config.networks[networkName].websocket,
  };
}

function isPositiveDecimal(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value) && Number(value) > 0;
}

function isUnsignedInteger(value: string): boolean {
  return /^\d+$/.test(value);
}
