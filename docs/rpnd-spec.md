# $rPND token spec

$rPND is the Multi-Purpose Token of Pond Protocol on the XRP Ledger. This file is the normative description of the issuance: what is fixed, what the issuer can still change, and what the ledger enforces.

**Status:** not issued on mainnet. Parameter values below are the current contents of `config/tokens.json`, which is the single source consumed by `src/metadata.ts` and `src/issuance.ts`. They are working defaults, not ratified economics.

## Identity

| | Value | Source |
| --- | --- | --- |
| Kind | Multi-Purpose Token (MPT) | — |
| Ticker | `RPND` | `rpnd.ticker` |
| Display name | `rPND` | `rpnd.name` |
| Issuer name | `rPND` | `rpnd.issuerName` |
| Asset class | `other` | `rpnd.assetClass` |
| On-ledger id | `MPTokenIssuanceID`, 192-bit / 48 hex chars | assigned by the ledger |
| Issuer account | TODO — cold account address | `ISSUER_SEED` |

The `MPTokenIssuanceID` is derived by the ledger from the issuer account and the sequence of the create transaction. It does not exist until `MPTokenIssuanceCreate` is validated, and it differs per network. `src/state.ts` persists it to `var/<network>-issuance.json`; `extractMptIssuanceId` in `src/issuance.ts` reads it out of the transaction metadata.

A ticker is not an identity. Only the `MPTokenIssuanceID` identifies $rPND. Any other issuance using ticker `RPND` is a different token.

## On-ledger parameters

Produced by `buildRpndIssuanceCreate`. Verify with `npx tsx src/cli.ts dry-run`.

| Field | Value | Changeable after create |
| --- | --- | --- |
| `AssetScale` | `6` | **No — permanent** |
| `MaximumAmount` | `1000000000000000` | **No — permanent** |
| `MPTokenMetadata` | XLS-89 hex, 249 bytes | Yes, via `MPTokenIssuanceSet`, unless frozen |
| `Flags` | `34` = `tfMPTCanTransfer` + `tfMPTCanLock` | Per flag, see below |
| `ImmutableFlags` | `64` = `tifMPTCanClawback` | **No — permanent** |
| `TransferFee` | omitted (`rpnd.transferFee` is `0`) | Yes, unless frozen |

`TransferFee` is only emitted when greater than zero, so the create transaction currently carries no such field. A transfer fee requires `tfMPTCanTransfer`.

## Amounts and precision

MPT amounts are integers in base units, interpreted at `AssetScale`:

```
display units = base units / 10^AssetScale = base units / 1_000_000
```

Every `value` in an MPT `Payment` is a base-unit string. `rpndAmount()` builds `{ mpt_issuance_id, value }`; there is no `currency`/`issuer` pair as with an IOU.

| | Base units | Display units |
| --- | --- | --- |
| `maximumAmount` | `1000000000000000` | 1,000,000,000 |
| `initialIssuance` | `1000000000000` | 1,000,000 |
| Ledger maximum | `9223372036854775807` (2^63−1) | 9,223,372,036,854.775807 |

`MaximumAmount` is enforced by the ledger: once outstanding supply reaches it, further mints fail. Because it cannot be raised later, it is the one parameter that must be right before the create transaction.

TODO (owner): confirm final `assetScale`, `maximumAmount`, and `initialIssuance`. Changing any of the first two after issuance requires destroying and re-creating the issuance, which changes the `MPTokenIssuanceID`.

## Metadata schema (XLS-89)

`rpndMetadata()` assembles this document and `encodeRpndMetadata()` hex-encodes it into `MPTokenMetadata`. Current content:

```json
{
  "ticker": "RPND",
  "name": "rPND",
  "desc": "rPND Multi-Purpose Token on the XRP Ledger.",
  "icon": "example.com/rpnd-icon.png",
  "asset_class": "other",
  "issuer_name": "rPND",
  "uris": [
    { "uri": "https://example.com/rpnd", "category": "website", "title": "rPND" }
  ],
  "additional_info": {
    "paired_iou_currency": "PND",
    "token_kind": "mpt"
  }
}
```

`additional_info.paired_iou_currency` is always overwritten with `config.pnd.currency` at build time, so it cannot drift from the IOU's actual code.

The `xrpl` encoder writes XLS-89 short keys on ledger, not the long names above — `t` ticker, `n` name, `d` desc, `i` icon, `ac` asset_class, `in` issuer_name, `us` uris (`u`, `c`, `t`), `ai` additional_info. Decode with `decodeMPTokenMetadata`, which `npx tsx src/cli.ts status` does for the live issuance.

**Size limit.** The encoded blob must be ≤ **1024 bytes**. It is currently **249 bytes**. `encodeRpndMetadata` throws above the limit, so a too-long `desc` or `uris` list fails locally rather than being rejected on ledger.

Constraints worth remembering: `ticker` is uppercase `A–Z` / `0–9`, max 6 characters. `asset_class` is one of `rwa`, `memes`, `wrapped`, `gaming`, `defi`, `other` (`AssetClass` in `src/types.ts`).

TODO (owner): replace the `example.com` icon and URI with production URLs before any mainnet create. They are published on ledger and, unless frozen, changing them costs a transaction.

## Flags

Set from `rpnd.flags` by `mptCreateFlags()`.

| Config key | Flag | Bit | Current | Effect |
| --- | --- | --- | --- | --- |
| `canTransfer` | `tfMPTCanTransfer` | 32 | **on** | Holders may transfer to third parties. Without it, holders can only send back to the issuer. |
| `canLock` | `tfMPTCanLock` | 2 | **on** | Issuer may lock the issuance or an individual holder's balance. |
| `canTrade` | `tfMPTCanTrade` | 16 | off | Permits DEX / AMM use. |
| `requireAuth` | `tfMPTRequireAuth` | 4 | off | Issuer must authorize each holder individually. |
| `canClawback` | `tfMPTCanClawback` | 64 | off | Issuer may claw back holder balances. |

Not exposed in config and therefore unset: `tfMPTCanEscrow` (8), `tfMPTCanHoldConfidentialBalance` (128).

`requireAuth` being off does **not** mean holders need no action. Every holder must still submit `MPTokenAuthorize` to create their `MPToken` object before they can receive $rPND. What `requireAuth` adds is a second, issuer-side approval.

### Immutable flags

`mptImmutableFlags()` emits `ImmutableFlags` from `rpnd.immutable`. Only `canClawback` is set, giving `tifMPTCanClawback` (64).

The effect is a permanent guarantee: clawback is off at create, and because the setting is frozen the issuer cannot enable it later with `MPTokenIssuanceSet`. **No holder of $rPND can have their balance confiscated by the issuer.**

Every other flag stays mutable. `MPTokenIssuanceSet` accepts `tfMPTSetCanLock`, `tfMPTSetRequireAuth`, `tfMPTSetCanEscrow`, `tfMPTSetCanTrade`, `tfMPTSetCanTransfer`, and `tfMPTSetCanClawback` (the last is inert here, being frozen), so the issuer retains discretion over the rest.

`xrpl@5` also defines `tifMPTMetadata` (65536) and `tifMPTTransferFee` (131072), which would freeze the metadata blob and the transfer fee. Neither is set. In this version `ImmutableFlags` is also accepted on `MPTokenIssuanceSet`, so hardening after create appears possible.

TODO (owner): two decisions. Should any of `canTransfer`, `canLock`, `canTrade`, or `requireAuth` be frozen at create so holders get the same permanence they get on clawback? Should metadata be frozen with `tifMPTMetadata` once production URLs are final? Also verify against the target rippled release whether `ImmutableFlags` on `MPTokenIssuanceSet` is honoured, rather than relying on the client library's type surface.

## Lifecycle

1. **Configure issuer.** `AccountSet` on the cold account — `configure-issuer`. Shared with $PND.
2. **Create.** `MPTokenIssuanceCreate` from the cold account — `issue-rpnd`. Returns the `MPTokenIssuanceID`. Fails on a network where `supportsMpt` is false.
3. **Authorize.** Each holder submits `MPTokenAuthorize` — `authorize-rpnd`. Creates their `MPToken` object.
4. **Mint.** `Payment` of the MPT from the issuer to a holder that has authorized — folded into `issue-rpnd` unless `--create-only`.
5. **Transfer.** Holder-to-holder `Payment` — `send-rpnd`. Requires `tfMPTCanTransfer`.
6. **Lock / update.** `MPTokenIssuanceSet` for lock, unlock, metadata, or mutable flags. Not exposed in the CLI.
7. **Destroy.** `MPTokenIssuanceDestroy` removes the issuance, and is only possible while no holder has a balance. Not exposed in the CLI.

Both steps 2 and 4 come from the cold key. Keep it offline in production; see [`issuance.md`](issuance.md).

## Invariants

These must hold for any $rPND issuance produced by this repo. The tests in `test/issuance.test.ts` and `test/metadata.test.ts` cover the mechanical ones.

1. Clawback is off and `tifMPTCanClawback` is set in the same create transaction.
2. Encoded metadata is ≤ 1024 bytes.
3. `additional_info.paired_iou_currency` equals `config.pnd.currency`.
4. No mainnet transaction is submitted by a faucet-funded key; `fund` refuses to run on mainnet.
5. `issue-rpnd` refuses to run where `networks.<name>.supportsMpt` is false.
6. Outstanding supply never exceeds `MaximumAmount` — enforced by the ledger, not by this repo.

## Relationship to $PND

Same issuing account, two unrelated ledger assets. $PND is an IOU identified by code `PND` plus the issuer address and held on trust lines; $rPND is an MPT identified by its `MPTokenIssuanceID` and held in `MPToken` objects. A $PND balance confers no claim on $rPND or the reverse.

`paired_iou_currency` in the metadata is a hint for indexers and operators. The ledger enforces no ratio, no peg, and no atomic conversion between an IOU and an MPT.

TODO (owner): define whether a conversion or redemption relationship exists, in which direction, at what ratio, and who operates it — or state that none exists. Until then nothing in this repo may be presented as a redemption promise.

## Change control

| Change | Path |
| --- | --- |
| `AssetScale`, `MaximumAmount` | Impossible after create. New issuance, new id. |
| Metadata | `MPTokenIssuanceSet` replaces the whole blob. Update `config/tokens.json` in the same change so the repo stays the source of truth. |
| Mutable flags | `MPTokenIssuanceSet`. Record the reason in the PR. |
| Frozen flags | Impossible. |

Any edit to `config/tokens.json` is a change to the token. See [CONTRIBUTING.md](../CONTRIBUTING.md).
