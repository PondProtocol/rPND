export const NETWORK_NAMES = ["devnet", "testnet", "mainnet"] as const;
export type NetworkName = (typeof NETWORK_NAMES)[number];

export type AssetClass = "rwa" | "memes" | "wrapped" | "gaming" | "defi" | "other";

export interface NetworkConfig {
  websocket: string;
  explorerAccount: string;
  explorerMpt: string;
  supportsMpt: boolean;
}

export interface PndIouConfig {
  kind: "iou";
  currency: "PND";
  name: string;
  desc: string;
  assetClass: AssetClass;
  displayDecimals: number;
  tickSize: number;
  transferRate: number;
  defaultRipple: boolean;
  disallowXrp: boolean;
  requireDestTag: boolean;
  operationalTrustLimit: string;
  initialIssuance: string;
}

export interface MptUri {
  uri: string;
  category: string;
  title: string;
}

export interface RpndMptFlags {
  canTransfer: boolean;
  canLock: boolean;
  canTrade: boolean;
  canClawback: boolean;
  requireAuth: boolean;
}

export interface RpndMptConfig {
  kind: "mpt";
  ticker: "RPND";
  name: string;
  desc: string;
  issuerName: string;
  icon: string;
  assetClass: AssetClass;
  assetScale: number;
  maximumAmount: string;
  transferFee: number;
  initialIssuance: string;
  uris: MptUri[];
  additionalInfo: Record<string, unknown>;
  flags: RpndMptFlags;
  immutable: {
    canClawback: boolean;
  };
}

export interface TokenConfig {
  product: "rPND";
  networks: Record<NetworkName, NetworkConfig>;
  pnd: PndIouConfig;
  rpnd: RpndMptConfig;
}

export interface IssuedAmount {
  currency: string;
  issuer: string;
  value: string;
}

export interface MptAmount {
  mpt_issuance_id: string;
  value: string;
}

export interface IssuanceState {
  network: NetworkName;
  issuerAddress?: string;
  operationalAddress?: string;
  rpndIssuanceId?: string;
  updatedAt: string;
}
