# $rPND

[![CI](https://github.com/pondprotocol/rpnd/actions/workflows/ci.yml/badge.svg)](https://github.com/pondprotocol/rpnd/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**$rPND is the reward token of Pond Protocol — a Multi-Purpose Token (MPT) on the XRP Ledger.**

It is an MPT rather than an IOU because rewards need things an IOU cannot do: a ledger-enforced supply ceiling, issuer-controlled on-ledger metadata, and per-issuance capability flags. Emission and reward mechanics are not decided yet.

**$PND launches first.** $rPND design work follows, so the $rPND parameters here remain provisional. For $PND, see [`docs/issuance.md`](docs/issuance.md).

This repository is the **operator source of truth** for Pond Protocol's on-ledger token configuration and issuance tooling: $rPND's parameters, its XLS-89 metadata, and the scripts that configure an issuer and create the issuance. It also carries the issuance path for the sibling IOU, **$PND**.

The tooling currently assumes one cold account issues both assets. That is an inherited default, **not a decision** — the $PND issuer is assigned and the $rPND issuer is still undecided. See [one cold account or two](docs/issuance.md#one-cold-account-or-two).

Where another Pond Protocol repo describes a token, `config/tokens.json` and `src/issuance.ts` here are authoritative on any mismatch.

| | $PND | $rPND |
| --- | --- | --- |
| Ledger type | IOU (issued currency) | Multi-Purpose Token |
| Identifier | currency code `PND` + issuer address | `MPTokenIssuanceID` (192-bit) |
| Ticker | — | `RPND` (XLS-89) |
| Holder opt-in | `TrustSet` trust line | `MPTokenAuthorize` |
| Supply cap | none on ledger | `MaximumAmount`, ledger-enforced |
| Precision | 15 significant digits | integer units at `AssetScale` |
| Metadata | XLS-26 `xrp-ledger.toml` (off ledger) | XLS-89 blob (on ledger) |

The two are **separate ledger assets**. Nothing on the ledger binds them together, and holding one does not entitle you to the other. See [Relationship to $PND](#relationship-to-pnd).

## Why an MPT and not an IOU

An IOU would have been the path of least resistance — trust lines are supported by every XRPL wallet and explorer today. $rPND is an MPT because the MPT primitive enforces in the protocol what an IOU can only promise in documentation:

- **Ledger-enforced supply cap.** `MaximumAmount` is fixed at create and the ledger rejects mints beyond it. An IOU issuer can always issue more; the only ceiling is each holder's trust limit.
- **Exact integer accounting.** MPT balances are integers interpreted at a declared `AssetScale`, so a balance is an exact count of base units. IOU balances are 15-significant-digit decimals, a floating representation that drifts under repeated arithmetic.
- **Metadata that travels with the asset.** The XLS-89 blob lives in `MPTokenMetadata` on the issuance object, so ticker, name, icon, and links resolve from the ledger itself. IOU metadata depends on an `xrp-ledger.toml` being reachable at the issuer's `Domain` and on the indexer choosing to scrape it.
- **Explicit, auditable capabilities.** Transfer, lock, escrow, trade, and clawback are individual flags declared at issuance, and `ImmutableFlags` can lock a decision permanently. Clawback for $rPND is off and frozen. An IOU's equivalent guarantees (freeze, clawback) are account-level and reversible.
- **No trust-line surface.** One `MPTokenAuthorize` object per holder, with no trust limits, no rippling, and no per-line freeze matrix to reason about.
- **One compact identifier.** An `MPTokenIssuanceID` is a single 192-bit value instead of a `(currency, issuer)` pair.

The cost of that is reach: MPTs need the MPTokens amendment and ecosystem support is still arriving. That is the tradeoff this repo accepts — see [Networks](#networks).

## Metadata model

$rPND carries metadata in two places, and they serve different consumers.

**On ledger (XLS-89).** `config/tokens.json` is the source; `src/metadata.ts` builds the JSON and hex-encodes it into `MPTokenMetadata`. Fields: `ticker`, `name`, `desc`, `icon`, `asset_class`, `issuer_name`, `uris`, and `additional_info`. The encoded blob must stay within **1024 bytes** — the encoder throws if it does not, so oversized `desc` or `uris` fail before submission rather than on ledger.

```bash
npx tsx src/cli.ts encode-metadata   # prints the JSON, its hex, and its byte count
```

**Off ledger (XLS-26).** `config/xrp-ledger.toml.template` renders the file hosted at `https://<domain>/.well-known/xrp-ledger.toml`, which is what XLS-26 explorers scrape. It is authoritative only once the issuer's AccountRoot `Domain` matches the host serving it. The $rPND `[[TOKENS]]` row is commented out in the template until an issuance ID exists.

## Flags model

Capabilities are declared once in `config/tokens.json` and mapped to real XRPL flags in `src/issuance.ts`.

| Config | XRPL flag | Current | Meaning |
| --- | --- | --- | --- |
| `canTransfer` | `tfMPTCanTransfer` | on | Holders may transfer to each other, not only back to the issuer |
| `canLock` | `tfMPTCanLock` | on | Issuer may lock balances via `MPTokenIssuanceSet` |
| `canTrade` | `tfMPTCanTrade` | off | Declares intent to allow DEX / AMM use, but MPT trading needs the MPTokensV2 amendment, which mainnet does not have |
| `requireAuth` | `tfMPTRequireAuth` | off | Issuer must approve each holder |
| `canClawback` | `tfMPTCanClawback` | off | Issuer may claw back balances |

`tfMPTCanEscrow` and `tfMPTCanHoldConfidentialBalance` are not set.

**Immutability.** `config/tokens.json` sets `immutable.canClawback`, which puts `tifMPTCanClawback` in `ImmutableFlags` on the create transaction. Clawback is therefore off *and* frozen: the issuer cannot grant itself clawback later.

Capability flags are **one-way**: `MPTokenIssuanceSet` can enable a flag, but nothing can disable one. No $rPND issuance exists on any network yet, so nothing is permanent today — `config/tokens.json` is a file, not ledger state. What the table above describes is the state that **would become permanent on create**: `canTransfer` and `canLock` could never be revoked afterwards, and `canTrade` or `requireAuth` could be enabled later but then never turned off.

`canLock` deserves attention because it is the mirror of the clawback guarantee. Creating with it on means **lock authority over $rPND is permanent and can never be renounced.** There is no MPT equivalent of the IOU's `asfNoFreeze`, which does let an IOU issuer give up freeze power for good. On the same token, holders would get a permanent no-clawback promise alongside permanent lock authority.

Enabling a flag after create also requires the **DynamicMPT** amendment, which is not live on mainnet — so on mainnet today flags cannot be changed in *either* direction. See [Status](#status).

`AssetScale` and `MaximumAmount` are fixed for the life of the issuance and cannot be changed by any later transaction. Review them before submitting the create.

## Supply and precision

> [!IMPORTANT]
> The values in `config/tokens.json` are **working defaults for devnet, not ratified token economics.** Do not quote them as $rPND's supply.

`assetScale` is `6`, so one display unit is 1,000,000 base units and all `value` fields in payments are in base units. `maximumAmount` is `1000000000000000` base units, which is 1,000,000,000 display units; the ledger's own ceiling is 2^63−1 base units. Final supply, initial mint, and scale are TODO for the owner.

`maximumAmount` caps supply **in circulation**, not cumulative issuance: paying $rPND to the issuer burns it and frees headroom to mint again. A fixed cap is therefore a ceiling on circulating supply rather than a limit on total emission over time.

## Pond Protocol repos

| Repo | Role |
| --- | --- |
| [`pondprotocol/rpnd`](https://github.com/pondprotocol/rpnd) | **This repo.** $rPND the MPT, plus the operator source of truth for on-ledger config and issuance tooling for both tokens |
| [`pondprotocol/pnd`](https://github.com/pondprotocol/pnd) | $PND the IOU — token-facing reference, holder and integrator docs |
| [`pondprotocol/protocol`](https://github.com/pondprotocol/protocol) | Pond Protocol itself |
| [`pondprotocol/.github`](https://github.com/pondprotocol/.github) | Organization profile |

The split between this repo and `pnd` is deliberate: `pnd` explains $PND to holders, wallets, and indexers, while the parameters both tokens are issued with live here in `config/tokens.json`. $PND's issuance path is in this repo because the issuing account is shared with $rPND. On any disagreement between a doc there and the config here, this repo wins.

$rPND is the Protocol's reward token. TODO (owner): what specifically earns it depends on what the Protocol does, which `protocol` does not define yet, so this README does not guess.

### Relationship to $PND

Both are Pond Protocol tokens, and at the ledger level the relationship is documentary only. $rPND's metadata carries `additional_info.paired_iou_currency = "PND"` so indexers and operators can see the intended pairing, but the XRPL does not link an IOU and an MPT, does not enforce a ratio between them, and offers no atomic swap between the two. Any conversion, redemption, or backing relationship would be a policy implemented off ledger or in the Protocol.

TODO (owner): whether $PND and $rPND are convertible, in which direction, at what ratio, and who operates that — all undefined. Nothing in this repo should be read as a redemption promise.

The `pnd` repo covers $PND from the holder and integrator side, including its own IOU-vs-MPT comparison. [`docs/mpt-vs-iou.md`](docs/mpt-vs-iou.md) here is the view from the MPT.

## Quick start

Node 22+.

```bash
npm install
cp .env.example .env
npm test
npm run typecheck
npx tsx src/cli.ts help
```

Print unsigned transactions (no network, no keys):

```bash
npx tsx src/cli.ts dry-run
npx tsx src/cli.ts encode-metadata
```

Devnet (faucet, MPT-capable) — never use these seeds on mainnet:

```bash
npx tsx src/cli.ts fund
# copy ISSUER_SEED and OPERATIONAL_SEED from the JSON into .env
npx tsx src/cli.ts configure-issuer
npx tsx src/cli.ts issue-pnd
npx tsx src/cli.ts issue-rpnd
npx tsx src/cli.ts status
```

`issue-rpnd` creates the MPT, has the operational account authorize it, and mints the configured initial amount. Pass `--create-only` to skip authorize + mint.

## Layout

- `config/tokens.json` — canonical $PND / $rPND parameters
- `config/xrp-ledger.toml.template` — XLS-26 file to host at `/.well-known/xrp-ledger.toml`
- `src/issuance.ts` — AccountSet, TrustSet, Payment, MPTokenIssuanceCreate, MPTokenAuthorize builders
- `src/cli.ts` — operator commands
- `docs/` — see below

| Doc | Covers |
| --- | --- |
| [`docs/rpnd-spec.md`](docs/rpnd-spec.md) | $rPND token spec: fields, flags, metadata schema, amounts, lifecycle, invariants |
| [`docs/mpt-vs-iou.md`](docs/mpt-vs-iou.md) | Why $rPND is an MPT, in detail, and what it costs |
| [`docs/tokens.md`](docs/tokens.md) | Token identity for both assets |
| [`docs/issuance.md`](docs/issuance.md) | Issuance procedure and network notes |

Local faucet output is written to `var/` (gitignored). Treat seeds as secrets.

## Networks

$rPND needs `MPTokensV1`, which is live on mainnet and Testnet. Two further amendments are **not** live on mainnet: **DynamicMPT** (XLS-94), needed for `ImmutableFlags` and for changing metadata, transfer fee, or flags after create; and **MPTokensV2** (XLS-82), needed for MPT DEX and AMM support. Mainnet issuance is a separate, reviewed operation — this repo does not faucet-fund mainnet accounts, and amendment status must be re-confirmed against the live ledger before any create.

**Rehearse on Testnet, not Devnet.** Testnet mirrors mainnet's amendment set (`MPTokensV1` on, `DynamicMPT` off). Devnet has `DynamicMPT` on, so it accepts transactions mainnet rejects — which is exactly how the blocker below would reach launch day unnoticed.

## Status

$rPND is **not issued** on any network from this repo. There is no `MPTokenIssuanceID` to publish yet, and `config/tokens.json` still contains `example.com` placeholders for the icon and website URI.

> [!WARNING]
> **The current config cannot be created on mainnet.** It sets `immutable.canClawback`, so the create carries `ImmutableFlags`, which requires the DynamicMPT amendment. Verified against Testnet using this repo's own builder: the create returns **`temDISABLED`**, and succeeds only with `ImmutableFlags` removed. Resolving this is a pre-issuance decision — either wait for DynamicMPT, or create without the freeze and accept that the no-clawback guarantee is then policy rather than ledger-enforced. This does not affect the $PND launch.

### Open questions

Tracked for the owner; none of these are decided:

- `MPTokenIssuanceID` for $rPND, per network — does not exist until `MPTokenIssuanceCreate` succeeds
- Whether $rPND is issued from the same cold account as $PND — a **$PND blocker**, since flags, `Domain`, and blackholing are account-level, so a shared account lets undecided $rPND choices constrain $PND
- $PND clawback and allow-listing, which close permanently at the issuer's first owner object — including a signer list, so multi-sig custody setup closes them too. Clawback and `asfNoFreeze` are also mutually exclusive
- $PND distribution topology — one operational account, several, or staged tranches
- Whether to issue $rPND before DynamicMPT activates, which decides how many of the flag choices below are permanent
- Whether to drop `immutable.canClawback` so a create can succeed on mainnet today, or wait for the amendment
- Whether `canEscrow` should be enabled at create — it is not in the config at all, and on mainnet it cannot be added later, so creating without it forfeits escrow-based lockups and vesting
- Final `maximumAmount`, `initialIssuance`, and `assetScale`
- Public domain for `ISSUER_DOMAIN` and XLS-26 hosting; production icon and URI values
- Whether the on-ledger `issuer_name` in `config/tokens.json` should become `Pond Protocol` — it is currently `rPND`, and the change alters the XLS-89 blob, so it is an issuance decision rather than a docs edit
- Legal issuer entity and key custody policy
- $PND ↔ $rPND conversion policy, if any, and which token is primary user-facing
- What specifically earns $rPND, the emission shape, and which sink is load-bearing
- Whether reward clawback is wanted, and whether permanent lock authority via `canLock` is acceptable
- Mainnet amendment status at issuance time, including **DynamicMPT**, which the current create depends on because it sets `ImmutableFlags`

$rPND emission and reward mechanics are deferred until after the $PND launch. The $PND decisions that close permanently at its first trust line are in [`docs/issuance.md`](docs/issuance.md#decisions-that-close-at-the-first-trust-line).

No security review or audit of this repository has been performed or commissioned.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security-sensitive reports: [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [`LICENSE`](LICENSE).
