# $rPND token spec

$rPND is the Multi-Purpose Token of Pond Protocol on the XRP Ledger. This file is the normative description of the issuance: what is fixed, what the issuer can still change, and what the ledger enforces.

**Status:** not issued on any network. Parameter values below are the current contents of `config/tokens.json`, which is the single source consumed by `src/metadata.ts` and `src/issuance.ts`. They are working defaults, not ratified economics.

> [!WARNING]
> **The create transaction this config builds cannot succeed on mainnet.** `ImmutableFlags` requires the DynamicMPT amendment, which is not enabled on mainnet. Verified on Testnet — which mirrors mainnet's amendment set — using `buildRpndIssuanceCreate` with the committed config: the create returns **`temDISABLED`**, and the identical transaction with `ImmutableFlags` removed returns `tesSUCCESS`. Rehearse on Testnet, not Devnet: Devnet has DynamicMPT enabled and will accept a transaction mainnet rejects.

Because nothing exists on ledger yet, **no $rPND property is permanent today.** This file describes what each value *would* fix at create. Every "permanent" below means permanent from the create transaction onward, not already settled.

This file and the config it describes are authoritative for $rPND across Pond Protocol's repos. If a document elsewhere in the organization disagrees, the config here is correct and the other document needs updating.

## Identity

| | Value | Source |
| --- | --- | --- |
| Kind | Multi-Purpose Token (MPT) | — |
| Ticker | `RPND` | `rpnd.ticker` |
| Display name | `rPND` | `rpnd.name` |
| Issuer name | `rPND` | `rpnd.issuerName` |
| Asset class | `other` | `rpnd.assetClass` |
| On-ledger id | `MPTokenIssuanceID`, 192-bit / 48 hex chars | assigned by the ledger |
| Issuer account | **TODO — undecided** | `ISSUER_SEED` |

The `MPTokenIssuanceID` is derived by the ledger from the issuer account and the sequence of the create transaction. It does not exist until `MPTokenIssuanceCreate` is validated, and it differs per network. `src/state.ts` persists it to `var/<network>-issuance.json`; `extractMptIssuanceId` in `src/issuance.ts` reads it out of the transaction metadata.

A ticker is not an identity. Only the `MPTokenIssuanceID` identifies $rPND. Any other issuance using ticker `RPND` is a different token.

The $rPND issuer account is deliberately still undecided. The owner has designated `rPNDRmfNNrUZstkA23haCUkCp7qLEPnaYc` as the **$PND issuer only**; it must not be recorded here as the $rPND issuer until that call is made. Issuing both assets from one cold account couples their account flags, `Domain`, and reserve exposure — see [`issuance.md`](issuance.md#one-cold-account-or-two).

TODO (owner): `issuerName` is `rPND`, so the on-ledger `issuer_name` reads `rPND` rather than `Pond Protocol`. Prose in this organization's repos now uses Pond Protocol branding; whether the XLS-89 field should follow is an issuance decision, not a docs edit, because it changes the encoded metadata blob and its byte count. Decide before the mainnet create.

## On-ledger parameters

Produced by `buildRpndIssuanceCreate`. Verify with `npx tsx src/cli.ts dry-run`.

| Field | Value | Changeable after create |
| --- | --- | --- |
| `AssetScale` | `6` | **No — permanent** |
| `MaximumAmount` | `1000000000000000` | **No — permanent** |
| `MPTokenMetadata` | XLS-89 hex, 249 bytes | Yes, via `MPTokenIssuanceSet`, unless frozen |
| `Flags` | `34` = `tfMPTCanTransfer` + `tfMPTCanLock` | Per flag, see below |
| `ImmutableFlags` | `64` = `tifMPTCanClawback` | **No — permanent.** Requires DynamicMPT; rejected with `temDISABLED` on mainnet today |
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

It caps `OutstandingAmount` — the amount **currently in circulation** — and not cumulative lifetime issuance. Any holder paying $rPND to the issuer burns it and decreases `OutstandingAmount`, which frees headroom the issuer can mint into again. A fixed `MaximumAmount` is therefore a ceiling on circulating supply, not a limit on how much is ever emitted. The issuer account also cannot hold its own MPT: conceptually it holds `MaximumAmount − OutstandingAmount`, which is why distributable inventory lives on the operational account.

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
| `canTrade` | `tfMPTCanTrade` | 16 | off | Would permit DEX / AMM use. MPT trading on the DEX and AMM is **not implemented on any network yet**, so the flag currently grants nothing. |
| `requireAuth` | `tfMPTRequireAuth` | 4 | off | Issuer must authorize each holder individually. |
| `canClawback` | `tfMPTCanClawback` | 64 | off | Issuer may claw back holder balances. |

Not exposed in config and therefore unset: `tfMPTCanEscrow` (8), `tfMPTCanHoldConfidentialBalance` (128).

`tfMPTCanEscrow` is worth singling out. `TokenEscrow` is enabled on mainnet, so escrow is the one lockup primitive actually available for MPTs — and because enabling a flag after create needs DynamicMPT, creating on mainnet today without `canEscrow` forfeits escrow-based lockups and vesting permanently. The config has no field for it.

`requireAuth` being off does **not** mean holders need no action. Every holder must still submit `MPTokenAuthorize` to create their `MPToken` object before they can receive $rPND. What `requireAuth` adds is a second, issuer-side approval.

### Immutable flags

`mptImmutableFlags()` emits `ImmutableFlags` from `rpnd.immutable`. Only `canClawback` is set, giving `tifMPTCanClawback` (64).

The intent is a permanent guarantee: clawback off at create, frozen so the issuer cannot enable it later. **On a network with DynamicMPT that means no holder of $rPND can ever have their balance confiscated by the issuer.** On mainnet today it is unachievable, because the transaction that would establish it is rejected. Leaving the flag off is still possible; backing it with an on-ledger guarantee is not.

**Capability flags are one-way.** This is easy to misread. `MPTokenIssuanceSet` can *enable* a capability flag (`tfMPTSetCanLock`, `tfMPTSetRequireAuth`, `tfMPTSetCanEscrow`, `tfMPTSetCanTrade`, `tfMPTSetCanTransfer`, `tfMPTSetCanClawback`), but there is no operation that disables one. Once on, a capability stays on.

Since no issuance exists, the column below is what each setting *would* fix at the create transaction — not the current position.

| Flag | Config | Effect of creating as configured |
| --- | --- | --- |
| `canTransfer`, `canLock` | on | Would become permanent; could never be revoked. |
| `canTrade`, `requireAuth`, `canEscrow` | off | Could be enabled later where DynamicMPT is live, then never revoked. Not enableable on mainnet today. |
| `canClawback` | off, freeze requested | Would be unreachable forever — but only where the freeze can be set. |

`tifMPTCanClawback` is doing real work where it is available: without it the issuer could enable clawback at any later point via `tfMPTSetCanClawback`. It is the freeze, not the initial off state, that makes the guarantee permanent.

**Lock authority is the mirror image.** Creating with `canLock` on means lock authority over $rPND is permanent and **can never be renounced** — there is no disable operation, and freezing the flag only pins it on. The IOU side has no such trap: an IOU issuer can permanently give up freeze power with `asfNoFreeze`. Nothing in this repo should suggest $rPND lock authority could be surrendered later. A create with the current config would hand holders a permanent no-clawback promise and permanent lock authority on the same token, which is a defensible pairing but an odd one to arrive at by default.

**On mainnet today, flags do not move in either direction.** Every `tfMPTSet*` enable path requires DynamicMPT, so a flag set chosen at create is fixed until the amendment activates, and one-way after that. The same applies to `MPTokenMetadata` and `TransferFee`: mutable in principle, frozen in practice on mainnet.

`tifMPTMetadata` (65536) and `tifMPTTransferFee` (131072) would freeze the metadata blob and the transfer fee. Neither is set, so both stay mutable.

`ImmutableFlags` can be declared at create or later with `MPTokenIssuanceSet`, and it is **additive**: each declaration adds to what is already fixed, never replaces it, and can never be cleared. So a flag that is currently off can be frozen off later — but only while it is still off, since enabling is irreversible. Freezing a flag that is already on records a fact rather than changing anything, which is why freezing `canTransfer` or `canLock` now would add nothing.

Mutating `ImmutableFlags`, `MPTokenMetadata`, or `TransferFee` requires the **DynamicMPT** amendment, as does setting `ImmutableFlags` at create. Since this repo's create transaction sets it, the create depends on DynamicMPT and not on MPTokensV1 alone; without it the transaction fails with `temDISABLED`.

TODO (owner): the first decision is whether to issue before DynamicMPT activates, because that determines whether anything below is deferrable. If issuing on mainnet today, the flag set, the metadata, and the transfer fee are all fixed at create, and no immutability commitment is possible — so `canEscrow`, `canTrade`, and `requireAuth` all become blocking rather than deferrable. If issuing under DynamicMPT, they can be enabled later and optionally frozen off instead. These are $rPND design decisions, deferred until after the $PND launch.

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

Both are Pond Protocol tokens, and they are two unrelated ledger assets. $PND is an IOU identified by code `PND` plus the issuer address and held on trust lines; $rPND is an MPT identified by its `MPTokenIssuanceID` and held in `MPToken` objects. A $PND balance confers no claim on $rPND or the reverse.

Whether they share an issuing account is **undecided**. The tooling assumes one cold account today, but that is a default rather than a design — see [`issuance.md`](issuance.md#one-cold-account-or-two) for the coupling a shared account would create.

`paired_iou_currency` in the metadata is a hint for indexers and operators. The ledger enforces no ratio, no peg, and no atomic conversion between an IOU and an MPT.

TODO (owner): define whether a conversion or redemption relationship exists, in which direction, at what ratio, and who operates it — or state that none exists. Until then nothing in this repo may be presented as a redemption promise.

## Change control

| Change | Path |
| --- | --- |
| `AssetScale`, `MaximumAmount` | Impossible after create. New issuance, new id. |
| Metadata | `MPTokenIssuanceSet` replaces the whole blob. Update `config/tokens.json` in the same change so the repo stays the source of truth. |
| Enabling an off capability flag | `MPTokenIssuanceSet`. One-way — record the reason in the PR, because it cannot be undone. |
| Disabling an on capability flag | Impossible. |
| Frozen flags | Impossible. |
| `TransferFee` | `MPTokenIssuanceSet`, unless frozen. Requires `canTransfer`, which is on. |

Any edit to `config/tokens.json` is a change to the token. See [CONTRIBUTING.md](../CONTRIBUTING.md).
