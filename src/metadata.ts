import { encodeMPTokenMetadata, type MPTokenMetadata } from "xrpl";
import { readFileSync } from "node:fs";
import { loadTokenConfig, tomlTemplatePath } from "./config.ts";
import type { TokenConfig } from "./types.ts";

const MAX_MPT_METADATA_BYTES = 1024;

export function rpndMetadata(config: TokenConfig = loadTokenConfig()): MPTokenMetadata {
  return {
    ticker: config.rpnd.ticker,
    name: config.rpnd.name,
    desc: config.rpnd.desc,
    icon: config.rpnd.icon,
    asset_class: config.rpnd.assetClass,
    issuer_name: config.rpnd.issuerName,
    uris: config.rpnd.uris,
    additional_info: {
      ...config.rpnd.additionalInfo,
      paired_iou_currency: config.pnd.currency,
    },
  };
}

export function encodeRpndMetadata(config: TokenConfig = loadTokenConfig()): string {
  const hex = encodeMPTokenMetadata(rpndMetadata(config));
  const bytes = hex.length / 2;
  if (bytes > MAX_MPT_METADATA_BYTES) {
    throw new Error(
      `rPND XLS-89 metadata is ${bytes} bytes; XRPL limit is ${MAX_MPT_METADATA_BYTES}. Shorten desc/uris.`,
    );
  }
  return hex;
}

export function domainToHex(domain: string): string {
  return Buffer.from(domain.trim(), "utf8").toString("hex").toUpperCase();
}

export function renderXrpLedgerToml(params: {
  issuerAddress: string;
  issuerDomain: string;
  network: string;
  rpndIssuanceId?: string;
  template?: string;
}): string {
  const tomlNetwork = params.network === "mainnet" ? "main" : params.network;
  const template = params.template ?? readFileSync(tomlTemplatePath(), "utf8");
  return template
    .replaceAll("{{ISSUER_ADDRESS}}", params.issuerAddress)
    .replaceAll("{{ISSUER_DOMAIN}}", params.issuerDomain)
    .replaceAll("{{NETWORK}}", tomlNetwork)
    .replaceAll("{{RPND_ISSUANCE_ID}}", params.rpndIssuanceId ?? "");
}
