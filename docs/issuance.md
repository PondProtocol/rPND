# Issuance

Ripple periodically resets Devnet and Testnet; never reuse those keys on mainnet.

## Rehearse on Testnet, not Devnet

> [!IMPORTANT]
> Pick the rehearsal network by its amendment set, not by habit. **Testnet mirrors mainnet** (`MPTokensV1` enabled, `DynamicMPT` not), so it reproduces what mainnet will do. **Devnet has `DynamicMPT` enabled**, so it accepts transactions mainnet rejects — a green Devnet rehearsal is not evidence that a mainnet create will work.

This is not hypothetical. The $rPND create this repo builds from the committed config carries `ImmutableFlags`, which requires `DynamicMPT`. Submitted to Testnet it returns **`temDISABLED`**; the same transaction without `ImmutableFlags` returns `tesSUCCESS`. On Devnet the original succeeds. A Devnet-only rehearsal would therefore have passed and the failure would have surfaced on launch day.

| Amendment | Mainnet | Gates |
| --- | --- | --- |
| `MPTokensV1` | enabled | MPTs at all |
| `TokenEscrow` | enabled | MPT escrow — the only working lockup primitive |
| `Clawback` | enabled | IOU clawback, opt-in per issuer account |
| `DynamicMPT` | **not enabled** | `ImmutableFlags`; changing metadata, transfer fee, or flags after create |

Amendment status is a point-in-time observation. Re-check it against the live ledger before any mainnet operation. `config/tokens.json` tracks only `supportsMpt` per network, which is necessary but not sufficient — it does not model `DynamicMPT`.

## Accounts

XRPL IOU practice is two keys:

1. **Issuer (cold)** — `AccountSet` + issues $PND + creates $rPND. Keep this seed offline in production.
2. **Operational (hot)** — opens the $PND trust line, authorizes $rPND, holds inventory for distribution.

`npx tsx src/cli.ts fund` creates both via the network faucet and writes `var/<network>-wallets.json`. Copy seeds into `.env` as `ISSUER_SEED` and `OPERATIONAL_SEED`.

### One cold account or two?

This tooling assumes a **single** cold account issues both assets: `ISSUER_SEED` signs the $PND `AccountSet` and `Payment` as well as the $rPND `MPTokenIssuanceCreate`. That is an inherited default, not a decision.

The owner has designated `rPNDRmfNNrUZstkA23haCUkCp7qLEPnaYc` as the **$PND issuer**. It is **not** assigned as the $rPND issuer, and `rpnd-spec.md` deliberately still lists the $rPND issuer as TODO.

Verified at time of writing: the address has a valid checksum but `account_info` returns `actNotFound` on mainnet, testnet, and devnet. The account does not exist yet, holds no XRP, and has no trust lines or other owner-directory objects. Everything in [Decisions that close at the first trust line](#decisions-that-close-at-the-first-trust-line) is therefore still open.

If one account issues both, the two assets are coupled in ways that cannot be undone selectively:

- **Account flags are shared.** `AccountSet` is per account, not per asset. `asfDefaultRipple`, `asfRequireAuth`, `asfGlobalFreeze`, `asfNoFreeze`, and `asfAllowTrustLineClawback` apply to the account, so an IOU policy choice made for $PND also lands on anything else that account issues. Several of these are irreversible.
- **`Domain` is shared.** One account has one `Domain`, so both assets resolve to the same XLS-26 `xrp-ledger.toml` and the same operator identity.
- **Reserve and key exposure are shared.** Each `MPTokenIssuance` costs the issuer 0.2 XRP in owner reserve, and every holder's MPT balance is tracked in the issuer's owner directory too. One compromised or unusable cold key affects both assets at once.
- **Blast radius is shared.** `asfGlobalFreeze` on the account freezes all its IOUs together.

Note that MPT capability flags are per issuance and so are *not* shared — the coupling is on the IOU/account side. Using a separate cold account for $rPND would decouple all of the above at the cost of a second key to custody and a second `Domain` or a shared one by convention.

TODO (owner): decide whether $rPND is issued from this same account or a separate one. The decision is only cheap while the $rPND issuance does not exist. It does not block the $PND launch, but issuing $PND first from this account does constrain what a shared-account $rPND would inherit.

## $PND (IOU)

1. `configure-issuer` — Default Ripple, tick size, transfer rate, optional `Domain`, Disallow XRP.
2. Operational `TrustSet` for `PND` / issuer.
3. Issuer `Payment` of `PND` to operational (and later to holders who have trust lines).

Holders who are not the operational account must send their own `TrustSet` before they can receive $PND.

### Decisions that close at the first trust line

> [!IMPORTANT]
> Step 2 above creates the issuer's first owner-directory object. Several `AccountSet` flags can only be enabled **before** that happens, and some can never be turned off afterwards. `configure-issuer` does not currently set any of them, so running the sequence as-is silently forecloses them.

| Flag | Constraint | Consequence of launching without it |
| --- | --- | --- |
| `asfAllowTrustLineClawback` (16) | Only settable while the owner directory is empty — no trust lines, offers, escrows, payment channels, checks, or signer lists. Cannot be reverted once set. Requires the Clawback amendment. | $PND can **never** be clawed back. Permanent. |
| `asfRequireAuth` (2) | Only settable while the account has no trust lines. | $PND can never be made allow-list only. |
| `asfNoFreeze` (6) | Can never be disabled once enabled. Must be signed with the master key pair. | Retaining freeze power is the default; giving it up stays available later, but only in one direction. |
| `asfAllowTrustLineLocking` (17) | Cannot be disabled once enabled. Requires the TokenEscrow amendment. | $PND cannot be placed in escrow. |

Because the designated $PND issuer does not exist on any network yet, all four are still open. The window for the first two closes the moment step 2 runs.

TODO (owner): decide clawback and allow-listing for $PND **before** the first `TrustSet` on mainnet. Clawback in particular is the mirror image of the $rPND decision — for the MPT it is set at issuance create, for the IOU it is set before the first trust line, and in both cases it is one-way. `configure-issuer` would need a flag to support any of these; none is implemented today.

### Trust limit and distribution topology

A trust line limit is the maximum the *holder* is willing to accept from the issuer, so the operational account cannot receive more $PND than its own limit allows.

`pnd.operationalTrustLimit` is now `100000000000`, matching the 100,000,000,000 total supply the owner set for $PND and documented in the `pnd` repo. It was previously `1000000000` — one hundredth of that — which meant a single operational account could not take delivery of full supply. Unlike the MPT's `AssetScale` and `MaximumAmount`, a trust limit is not permanent: the holder can raise or lower it with another `TrustSet` at any time, so this is a safe default rather than a commitment.

Raising the default does not by itself decide the topology, and a limit at or above full supply is compatible with all of these:

- **Single operational account.** Simplest, and what the CLI assumes. One hot key is exposed to the entire distributable supply.
- **Multiple operational accounts.** Each opens its own trust line, so `--limit` should be passed per account rather than relying on the default. Splits key risk; more accounts to fund and track.
- **Staged distribution.** Keep the limit high but issue in tranches, so undelivered supply stays as issuer obligation rather than sitting in a hot wallet.

`buildPndTrustSet` accepts a `limit` override, and `issue-pnd` accepts `--value`, so any of these works without a config change.

TODO (owner): choose the topology before mainnet. Full supply reachable by one hot key is the current default, and it is a custody decision rather than a technical constraint.

## $rPND (MPT)

Requires an MPT-capable network. `MPTokensV1` is live on mainnet, Testnet, and Devnet; `config/tokens.json` now marks all three `supportsMpt: true` (the previous `false` for Testnet was stale).

1. `issue-rpnd` — `MPTokenIssuanceCreate` with XLS-89 metadata from `config/tokens.json`.
2. Unless `--create-only`, operational `MPTokenAuthorize` then issuer `Payment` of the MPT.
3. Persist `mpt_issuance_id` (also stored in `var/<network>-issuance.json`).

`AssetScale` and `MaximumAmount` are fixed for the life of the issuance. Review them before the create transaction.

**As configured, step 1 fails on mainnet.** `tifMPTCanClawback` is requested via `ImmutableFlags`, which needs `DynamicMPT`. Where the amendment is absent the create returns `temDISABLED`; where it is present, clawback is genuinely frozen off. The decision is to wait for the amendment or to create without the freeze and treat "no clawback" as policy rather than an on-ledger guarantee. Note that on a pre-`DynamicMPT` network no flag can be enabled afterwards either, so an unfrozen clawback flag cannot actually be switched on until the amendment lands — at which point it could be, unless frozen promptly.

$rPND issuance is not on the $PND launch path; none of this blocks $PND.

## Metadata publication

1. `npx tsx src/cli.ts render-toml --issuer <cold-address> --domain <host>`
2. Serve the file at `https://<host>/.well-known/xrp-ledger.toml`
3. Re-run `configure-issuer --domain <host>` so the AccountRoot `Domain` matches

Explorers that implement XLS-26 will scrape that file. $rPND discovery also depends on the on-ledger XLS-89 blob.

## Mainnet

There is no faucet command on mainnet. Fund accounts independently, re-confirm amendment status against the live ledger, replace placeholder icon/URI/domain values, then submit the same transaction sequence with production seeds held outside this repo.

For $PND specifically, settle [the decisions that close at the first trust line](#decisions-that-close-at-the-first-trust-line) and the [distribution topology](#trust-limit-and-distribution-topology) before step 2 of the $PND sequence. For $rPND, resolve the `ImmutableFlags` / `DynamicMPT` position first, since the create cannot succeed on mainnet as configured.
