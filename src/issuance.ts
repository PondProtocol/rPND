import {
  AccountSetAsfFlags,
  AccountSetTfFlags,
  MPTokenIssuanceCreateFlags,
  MPTokenIssuanceCreateImmutableFlags,
  type AccountSet,
  type MPTokenAuthorize,
  type MPTokenIssuanceCreate,
  type Payment,
  type TransactionMetadata,
  type TrustSet,
} from "xrpl";
import { domainToHex, encodeRpndMetadata } from "./metadata.ts";
import type { IssuedAmount, MptAmount, TokenConfig } from "./types.ts";

export function pndAmount(issuer: string, value: string, config: TokenConfig): IssuedAmount {
  return {
    currency: config.pnd.currency,
    issuer,
    value,
  };
}

export function rpndAmount(issuanceId: string, value: string): MptAmount {
  return {
    mpt_issuance_id: issuanceId,
    value,
  };
}

export function buildIssuerAccountSet(params: {
  issuerAddress: string;
  config: TokenConfig;
  domain?: string;
}): AccountSet {
  const { pnd } = params.config;
  let flags = 0;
  if (pnd.disallowXrp) flags |= AccountSetTfFlags.tfDisallowXRP;
  if (pnd.requireDestTag) flags |= AccountSetTfFlags.tfRequireDestTag;

  const tx: AccountSet = {
    TransactionType: "AccountSet",
    Account: params.issuerAddress,
    TransferRate: pnd.transferRate,
    TickSize: pnd.tickSize,
  };

  if (pnd.defaultRipple) {
    tx.SetFlag = AccountSetAsfFlags.asfDefaultRipple;
  }
  if (flags !== 0) {
    tx.Flags = flags;
  }
  if (params.domain) {
    tx.Domain = domainToHex(params.domain);
  }
  return tx;
}

export function buildPndTrustSet(params: {
  holderAddress: string;
  issuerAddress: string;
  config: TokenConfig;
  limit?: string;
}): TrustSet {
  return {
    TransactionType: "TrustSet",
    Account: params.holderAddress,
    LimitAmount: pndAmount(
      params.issuerAddress,
      params.limit ?? params.config.pnd.operationalTrustLimit,
      params.config,
    ),
  };
}

export function buildPndPayment(params: {
  from: string;
  to: string;
  issuerAddress: string;
  value: string;
  config: TokenConfig;
}): Payment {
  return {
    TransactionType: "Payment",
    Account: params.from,
    Destination: params.to,
    Amount: pndAmount(params.issuerAddress, params.value, params.config),
  };
}

export function mptCreateFlags(config: TokenConfig): number {
  const { flags } = config.rpnd;
  let value = 0;
  if (flags.canLock) value |= MPTokenIssuanceCreateFlags.tfMPTCanLock;
  if (flags.requireAuth) value |= MPTokenIssuanceCreateFlags.tfMPTRequireAuth;
  if (flags.canTrade) value |= MPTokenIssuanceCreateFlags.tfMPTCanTrade;
  if (flags.canTransfer) value |= MPTokenIssuanceCreateFlags.tfMPTCanTransfer;
  if (flags.canClawback) value |= MPTokenIssuanceCreateFlags.tfMPTCanClawback;
  return value;
}

export function mptImmutableFlags(config: TokenConfig): number | undefined {
  if (!config.rpnd.immutable.canClawback) return undefined;
  return MPTokenIssuanceCreateImmutableFlags.tifMPTCanClawback;
}

export function buildRpndIssuanceCreate(params: {
  issuerAddress: string;
  config: TokenConfig;
}): MPTokenIssuanceCreate {
  const { rpnd } = params.config;
  const tx: MPTokenIssuanceCreate = {
    TransactionType: "MPTokenIssuanceCreate",
    Account: params.issuerAddress,
    AssetScale: rpnd.assetScale,
    MaximumAmount: rpnd.maximumAmount,
    MPTokenMetadata: encodeRpndMetadata(params.config),
  };

  const flags = mptCreateFlags(params.config);
  if (flags !== 0) tx.Flags = flags;

  if (rpnd.transferFee > 0) {
    tx.TransferFee = rpnd.transferFee;
  }

  const immutable = mptImmutableFlags(params.config);
  if (immutable !== undefined) {
    tx.ImmutableFlags = immutable;
  }

  return tx;
}

export function buildRpndAuthorize(params: {
  holderAddress: string;
  issuanceId: string;
}): MPTokenAuthorize {
  return {
    TransactionType: "MPTokenAuthorize",
    Account: params.holderAddress,
    MPTokenIssuanceID: params.issuanceId,
  };
}

export function buildRpndPayment(params: {
  from: string;
  to: string;
  issuanceId: string;
  value: string;
}): Payment {
  return {
    TransactionType: "Payment",
    Account: params.from,
    Destination: params.to,
    Amount: rpndAmount(params.issuanceId, params.value),
  };
}

export function extractMptIssuanceId(meta: TransactionMetadata | string | undefined): string | undefined {
  if (!meta || typeof meta === "string") return undefined;

  const direct = (meta as TransactionMetadata & { mpt_issuance_id?: string }).mpt_issuance_id;
  if (typeof direct === "string" && direct.length > 0) return direct;

  for (const node of meta.AffectedNodes ?? []) {
    if (!("CreatedNode" in node)) continue;
    const created = node.CreatedNode;
    if (created.LedgerEntryType !== "MPTokenIssuance") continue;
    const fields = created.NewFields as {
      mpt_issuance_id?: string;
      MPTokenIssuanceID?: string;
    };
    return fields.mpt_issuance_id ?? fields.MPTokenIssuanceID;
  }

  return undefined;
}

export function assertTesSuccess(result: string | undefined, label: string): void {
  if (result !== "tesSUCCESS") {
    throw new Error(`${label} failed: ${result ?? "missing TransactionResult"}`);
  }
}
