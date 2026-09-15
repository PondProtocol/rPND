# Issuance

Use Devnet until the transactions and metadata look correct. Ripple periodically resets Devnet and Testnet; do not reuse those keys on mainnet.

## Accounts

XRPL IOU practice is two keys:

1. **Issuer (cold)** — `AccountSet` + issues $PND + creates $rPND. Keep this seed offline in production.
2. **Operational (hot)** — opens the $PND trust line, authorizes $rPND, holds inventory for distribution.

`npx tsx src/cli.ts fund` creates both via the network faucet and writes `var/<network>-wallets.json`. Copy seeds into `.env` as `ISSUER_SEED` and `OPERATIONAL_SEED`.

## $PND (IOU)

1. `configure-issuer` — Default Ripple, tick size, transfer rate, optional `Domain`, Disallow XRP.
2. Operational `TrustSet` for `PND` / issuer.
3. Issuer `Payment` of `PND` to operational (and later to holders who have trust lines).

Holders who are not the operational account must send their own `TrustSet` before they can receive $PND.

## $rPND (MPT)

Requires an MPT-capable network (Devnet in this repo’s defaults; Testnet is flagged `supportsMpt: false`).

1. `issue-rpnd` — `MPTokenIssuanceCreate` with XLS-89 metadata from `config/tokens.json`.
2. Unless `--create-only`, operational `MPTokenAuthorize` then issuer `Payment` of the MPT.
3. Persist `mpt_issuance_id` (also stored in `var/<network>-issuance.json`).

`AssetScale` and `MaximumAmount` are fixed for the life of the issuance. Review them before the create transaction.

Clawback is not enabled, and `tifMPTCanClawback` is set so the issuer cannot add clawback later.

## Metadata publication

1. `npx tsx src/cli.ts render-toml --issuer <cold-address> --domain <host>`
2. Serve the file at `https://<host>/.well-known/xrp-ledger.toml`
3. Re-run `configure-issuer --domain <host>` so the AccountRoot `Domain` matches

Explorers that implement XLS-26 will scrape that file. $rPND discovery also depends on the on-ledger XLS-89 blob.

## Mainnet

There is no faucet command on mainnet. Fund accounts independently, confirm amendment support for MPTs, replace placeholder icon/URI/domain values, then submit the same transaction sequence with production seeds held outside this repo.
