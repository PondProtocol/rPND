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
import { encodeRpndMetadata } from "./metadata.ts";
import type { IssuedAmount, MptAmount, TokenConfig } from "./types.ts";

export function pndAmount(issuer: string, value: string, config: TokenConfig): IssuedAmount {
  return {
    currency: config.pnd.currency,
    issuer,
    value,
  };
}

/**
 * The `asf*` account flags this toolkit can build a standalone AccountSet
 * for. `SetFlag`/`ClearFlag` carry exactly one value per transaction, so
 * each of these is its own transaction, never combined.
 */
export const ISSUER_FLAG_VALUES = {
  defaultRipple: AccountSetAsfFlags.asfDefaultRipple,
  requireAuth: AccountSetAsfFlags.asfRequireAuth,
  noFreeze: AccountSetAsfFlags.asfNoFreeze,
  allowTrustLineClawback: AccountSetAsfFlags.asfAllowTrustLineClawback,
  allowTrustLineLocking: AccountSetAsfFlags.asfAllowTrustLineLocking,
} as const satisfies Record<string, AccountSetAsfFlags>;

export type IssuerFlagName = keyof typeof ISSUER_FLAG_VALUES;

export function isIssuerFlagName(value: string): value is IssuerFlagName {
  return value in ISSUER_FLAG_VALUES;
}

/**
 * A single, standalone `AccountSet` that sets or clears exactly one `asf`
 * flag and nothing else — the shape every launch-critical flag decision
 * (clawback, NoFreeze, RequireAuth, trust-line locking) actually needs.
 * `buildIssuerAccountSet` below stays reserved for the "main" configuration
 * transaction (DefaultRipple + Domain + TransferRate + TickSize).
 */
export function buildIssuerFlagAccountSet(params: {
  issuerAddress: string;
  flag: IssuerFlagName;
  mode?: "set" | "clear";
}): AccountSet {
  const tx: AccountSet = {
    TransactionType: "AccountSet",
    Account: params.issuerAddress,
  };
  const flagValue = ISSUER_FLAG_VALUES[params.flag];
  if ((params.mode ?? "set") === "clear") {
    tx.ClearFlag = flagValue;
  } else {
    tx.SetFlag = flagValue;
  }
  return tx;
}

/** A chosen configuration of the launch-critical, one-flag-per-transaction decisions. */
export interface IssuerFlagPlan {
  /** `asfAllowTrustLineClawback` (16) — now-or-never, before any owner-directory object. */
  clawback?: boolean;
  /** `asfRequireAuth` (2) — now-or-never, before the first trust line. */
  requireAuth?: boolean;
  /** `asfNoFreeze` (6) — permanent; must be signed with the master key. */
  noFreeze?: boolean;
  /** `asfAllowTrustLineLocking` (17) — reversible, no deadline; required before any escrow of this issuer's currency. */
  allowTrustLineLocking?: boolean;
}

export function assertFlagPlanNotContradictory(plan: IssuerFlagPlan): void {
  if (plan.clawback && plan.noFreeze) {
    throw new Error(
      "asfAllowTrustLineClawback and asfNoFreeze are permanently mutually exclusive on the same account " +
        "(enabling one forecloses the other with tecNO_PERMISSION). Refusing to build a configuration that requests both.",
    );
  }
}

/**
 * Build the full ordered sequence of `AccountSet` transactions for a chosen
 * flag configuration, following the launch runbook's ordering: any now-or-never
 * flags first (clawback, then RequireAuth — both close at the first trust line),
 * then the main configuration transaction (DefaultRipple/Domain/TransferRate/TickSize),
 * then NoFreeze, then the escrow-locking flag. Guards against the one
 * contradictory pair; every flag is otherwise optional and caller-chosen.
 */
export function buildIssuerConfigurationSequence(params: {
  issuerAddress: string;
  config: TokenConfig;
  domain?: string;
  plan: IssuerFlagPlan;
}): AccountSet[] {
  assertFlagPlanNotContradictory(params.plan);

  const txs: AccountSet[] = [];
  if (params.plan.clawback) {
    txs.push(buildIssuerFlagAccountSet({ issuerAddress: params.issuerAddress, flag: "allowTrustLineClawback" }));
  }
  if (params.plan.requireAuth) {
    txs.push(buildIssuerFlagAccountSet({ issuerAddress: params.issuerAddress, flag: "requireAuth" }));
  }
  txs.push(
    buildIssuerAccountSet({
      issuerAddress: params.issuerAddress,
      config: params.config,
      ...(params.domain ? { domain: params.domain } : {}),
    }),
  );
  if (params.plan.noFreeze) {
    txs.push(buildIssuerFlagAccountSet({ issuerAddress: params.issuerAddress, flag: "noFreeze" }));
  }
  if (params.plan.allowTrustLineLocking) {
    txs.push(buildIssuerFlagAccountSet({ issuerAddress: params.issuerAddress, flag: "allowTrustLineLocking" }));
  }
  return txs;
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
  /**
   * Override which single `asf` flag (if any) this AccountSet carries.
   * Defaults to the existing behaviour — `asfDefaultRipple` when
   * `pnd.defaultRipple` is true — so existing call sites are unaffected.
   * Pass `null` to omit any flag, or a name from `IssuerFlagName` to set a
   * different one on this same transaction. For a flag transaction with no
   * other fields (the shape every other launch-critical flag decision
   * actually needs), use `buildIssuerFlagAccountSet` instead.
   */
  flag?: IssuerFlagName | null;
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

  if (params.flag !== undefined) {
    if (params.flag !== null) {
      tx.SetFlag = ISSUER_FLAG_VALUES[params.flag];
    }
  } else if (pnd.defaultRipple) {
    tx.SetFlag = AccountSetAsfFlags.asfDefaultRipple;
  }
  if (flags !== 0) {
    tx.Flags = flags;
  }
  if (params.domain) {
    tx.Domain = Buffer.from(params.domain.trim(), "utf8").toString("hex").toUpperCase();
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
