# $rPND

[![CI](https://github.com/pondprotocol/rpnd/actions/workflows/ci.yml/badge.svg)](https://github.com/pondprotocol/rpnd/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**$rPND is the Multi-Purpose Token (MPT) of Pond Protocol on the XRP Ledger.**

This repository is the operator source of truth for $rPND: its on-ledger parameters, its XLS-89 metadata, and the scripts that configure an issuer and create the issuance. It also carries the sibling IOU, **$PND**, because both assets come from the same issuing account.

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
| `canTrade` | `tfMPTCanTrade` | off | Use in DEX / AMM contexts |
| `requireAuth` | `tfMPTRequireAuth` | off | Issuer must approve each holder |
| `canClawback` | `tfMPTCanClawback` | off | Issuer may claw back balances |

`tfMPTCanEscrow` and `tfMPTCanHoldConfidentialBalance` are not set.

**Immutability.** `config/tokens.json` sets `immutable.canClawback`, which puts `tifMPTCanClawback` in `ImmutableFlags` on the create transaction. Clawback is therefore off *and* frozen: the issuer cannot grant itself clawback later. Every other flag above remains changeable by the issuer through `MPTokenIssuanceSet` unless it is frozen too. Which further flags should be frozen at create is an open decision — see [Open questions](#open-questions).

`AssetScale` and `MaximumAmount` are fixed for the life of the issuance and cannot be changed by any later transaction. Review them before submitting the create.

## Supply and precision

> [!IMPORTANT]
> The values in `config/tokens.json` are **working defaults for devnet, not ratified token economics.** Do not quote them as $rPND's supply.

`assetScale` is `6`, so one display unit is 1,000,000 base units and all `value` fields in payments are in base units. `maximumAmount` is `1000000000000000` base units, which is 1,000,000,000 display units; the ledger's own ceiling is 2^63−1 base units. Final supply, initial mint, and scale are TODO for the owner.

## How this repo fits together

| Repo | Contents |
| --- | --- |
| [`pondprotocol/rpnd`](https://github.com/pondprotocol/rpnd) | This repo — $rPND parameters, metadata, and the issuance toolkit (and $PND's issuance, since the issuer is shared) |
| [`pondprotocol/pnd`](https://github.com/pondprotocol/pnd) | $PND, the IOU |
| [`pondprotocol/protocol`](https://github.com/pondprotocol/protocol) | Pond Protocol itself |

TODO (owner): the `pnd` and `protocol` repos are currently placeholders. Once they have content, state here which repo is authoritative for $PND's parameters — today they live in this repo's `config/tokens.json` because the issuing account is shared — and what role $rPND plays in the Protocol (utility, fees, governance, or something else). This README deliberately does not guess.

### Relationship to $PND

At the ledger level the relationship is documentary only. $rPND's metadata carries `additional_info.paired_iou_currency = "PND"` so indexers and operators can see the intended pairing, but the XRPL does not link an IOU and an MPT, does not enforce a ratio between them, and offers no atomic swap between the two. Any conversion, redemption, or backing relationship would be a policy implemented off ledger or in the Protocol.

TODO (owner): whether $PND and $rPND are convertible, in which direction, at what ratio, and who operates that — all undefined. Nothing in this repo should be read as a redemption promise.

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

$rPND requires the MPTokens amendment. Default scripts target **Devnet**. Testnet is marked `supportsMpt: false` in config until that network has the amendment. Mainnet issuance is a separate, reviewed operation — this repo does not faucet-fund mainnet accounts, and amendment status must be confirmed against the live ledger before a mainnet create.

## Status

$rPND is **not issued** on mainnet from this repo. There is no `MPTokenIssuanceID` to publish yet, and `config/tokens.json` still contains `example.com` placeholders for the icon and website URI.

### Open questions

Tracked for the owner; none of these are decided:

- `MPTokenIssuanceID` for $rPND, per network — does not exist until `MPTokenIssuanceCreate` succeeds
- Issuer (cold) and operational classic addresses
- Final `maximumAmount`, `initialIssuance`, and `assetScale`
- Public domain for `ISSUER_DOMAIN` and XLS-26 hosting; production icon and URI values
- Legal issuer entity and key custody policy
- $PND ↔ $rPND conversion policy, if any
- $rPND's role in Pond Protocol
- Whether flags beyond clawback should be frozen at create, and whether metadata should be frozen with `tifMPTMetadata`
- Mainnet MPTokens amendment status at issuance time

No security review or audit of this repository has been performed or commissioned.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security-sensitive reports: [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [`LICENSE`](LICENSE).
