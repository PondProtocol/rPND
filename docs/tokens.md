# Token identity

rPND issues two related XRP Ledger assets. They are not interchangeable on ledger: one is a classic issued currency, the other is an MPT.

## $PND — IOU

- **Kind:** issued currency (IOU) on trust lines
- **Currency code:** `PND` (standard 3-character XRPL code)
- **Issuer:** the cold account configured by `configure-issuer`
- **Holders:** must `TrustSet` `PND` to that issuer before they can receive it
- **Metadata:** XLS-26 `[[TOKENS]]` / `[[CURRENCIES]]` in `xrp-ledger.toml`, linked by the issuer `Domain` field
- **Defaults in `config/tokens.json`:** Default Ripple on, Disallow XRP on, transfer rate 0, tick size 5

IOU amounts use `{ currency, issuer, value }`. The issuer classic address is part of the asset identity. A different issuer with code `PND` is a different token.

## $rPND — MPT

- **Kind:** Multi-Purpose Token
- **Ticker (XLS-89):** `RPND` (uppercase A–Z / 0–9, max 6 characters)
- **Display name:** rPND
- **On-ledger id:** `MPTokenIssuanceID` returned by `MPTokenIssuanceCreate`
- **Metadata:** XLS-89 JSON, hex-encoded into `MPTokenMetadata` (1024-byte cap)
- **Holders:** must submit `MPTokenAuthorize` before they can receive the MPT
- **Defaults:** transferable, lockable, clawback permanently disabled via `ImmutableFlags`

MPT payments use `{ mpt_issuance_id, value }`. Scale is `assetScale` (6 in the default config), so `value` is in fractional units.

Replace `rpnd.icon` and `rpnd.uris` in `config/tokens.json` with production URLs before mainnet create. Metadata updates after issuance replace the whole blob unless metadata is later marked immutable.

## Pairing

`additional_info.paired_iou_currency` on $rPND is `PND`. That is documentation for indexers and operators. The ledger does not atomically bind the IOU and the MPT.

## What this file does not define

Legal issuer entity, custody policy, and public website domain are operator decisions. Set `ISSUER_DOMAIN` and host `/.well-known/xrp-ledger.toml` before treating metadata as public.
