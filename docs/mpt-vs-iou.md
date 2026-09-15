# Why $rPND is an MPT

The XRP Ledger offers two ways to issue a fungible asset: a classic issued currency ("IOU") on trust lines, or a Multi-Purpose Token. $rPND is an MPT. This file records why, and what that choice costs.

This is a comparison of ledger primitives. Why Pond Protocol has both a $PND IOU and an $rPND MPT at all is a product question, and it is TODO for the owner — see [`rpnd-spec.md`](rpnd-spec.md#relationship-to-pnd).

## Side by side

| | IOU | MPT |
| --- | --- | --- |
| Identity | `(currency code, issuer address)` | `MPTokenIssuanceID`, 192-bit |
| Holder opt-in | `TrustSet` creating a `RippleState` line | `MPTokenAuthorize` creating an `MPToken` |
| Holder-side limits | Trust limit per line, set by the holder | None |
| Supply cap | None on ledger | `MaximumAmount`, ledger-enforced, permanent |
| Amount encoding | Decimal, 15 significant digits | Integer base units at a fixed `AssetScale` |
| Metadata | Off ledger, `xrp-ledger.toml` at the issuer's `Domain` | On ledger, `MPTokenMetadata`, ≤ 1024 bytes |
| Capabilities | Account-level flags, mostly reversible | Per-issuance flags, individually freezable |
| Clawback | Account-level `asfAllowTrustLineClawback` | `tfMPTCanClawback`, freezable at create |
| Rippling | Yes — `DefaultRipple`, `NoRipple` per line | Not applicable |
| Ecosystem support | Universal | Requires the MPTokens amendment |

## What the MPT buys

**A supply cap the protocol enforces.** `MaximumAmount` is fixed at create and cannot be raised by any later transaction. The ledger rejects mints past it. An IOU has no equivalent: the issuer's balance is negative by construction and bounded only by what each holder's trust limit permits, so "fixed supply" for an IOU is a claim about issuer behaviour. For $rPND it is a property of the issuance.

**Exact integer accounting.** IOU balances are 15-significant-digit decimals. That is a floating representation, and repeated arithmetic on it drifts. MPT balances are integers in base units with a declared `AssetScale`, so a balance is an exact count and supply always sums exactly.

**Metadata that cannot be taken offline.** An IOU's name, icon, and links come from an `xrp-ledger.toml` served over HTTPS at whatever domain the issuer's `Domain` field points to. Let the domain lapse and the token loses its identity in every explorer that scrapes it. An MPT's XLS-89 blob is a field on the issuance object. Anyone with a ledger connection can resolve $rPND's ticker and name, with no DNS or web server in the path. $rPND still publishes an `xrp-ledger.toml` because XLS-26 consumers expect it, but it is a convenience and not the root of identity.

**Guarantees rather than promises.** The MPT flags are per-issuance, and `ImmutableFlags` makes a decision permanent. $rPND sets `tifMPTCanClawback`, so "the issuer cannot confiscate your balance" is verifiable from the create transaction forever. The IOU analogue, clawback, is an account-level setting on the issuer; a holder would have to trust that it is never enabled and keep checking.

**A smaller surface to reason about.** No trust limits, no rippling, no `NoRipple` per line, no `DefaultRipple` interaction, and one object per holder. Fewer moving parts is fewer ways for an operator to make a quiet mistake.

## What it costs

**Reach.** MPTs need the MPTokens amendment. `config/tokens.json` marks Testnet `supportsMpt: false` for exactly this reason, and `issue-rpnd` refuses to run there. Wallets, explorers, and venues support MPTs unevenly while the primitive is still rolling out, whereas trust-line IOUs work everywhere today. This is the real price of the choice.

**DEX and AMM access is a flag, not a given.** IOUs trade on the DEX by default. An MPT needs `tfMPTCanTrade`, which $rPND does not currently set.

**Holders must authorize.** An `MPTokenAuthorize` is required before receiving $rPND, even with `requireAuth` off. Comparable to a `TrustSet` in effort, but it is a step that integrators must implement rather than assume.

**Permanence cuts both ways.** `AssetScale` and `MaximumAmount` can never change. Getting either wrong means destroying the issuance and creating a new one under a new `MPTokenIssuanceID`, which is only possible while no holder holds a balance.

## Why $PND remains an IOU

$PND is an issued currency with code `PND` and is issued from the same cold account as $rPND. This repo does not convert it to an MPT.

TODO (owner): the reason both exist, and their intended division of roles, is not documented anywhere in this organization's repos. State it in [`../README.md`](../README.md) once decided. What is true on ledger today: they are separate assets, the pairing is recorded only as `additional_info.paired_iou_currency` metadata, and no ledger mechanism binds them.
