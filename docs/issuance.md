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

XRPL IOU practice is two keys, extended here to four named roles now that the topology is decided:

1. **Issuer (cold)** — `rPNDRmfNNrUZstkA23haCUkCp7qLEPnaYc`. `AccountSet` + issues $PND + creates $rPND. Keep this seed offline in production. Funded on mainnet with 2.539034 XRP; completely unconfigured (`Flags` 0, `OwnerCount` 0).
2. **Treasury** — `rPNDcL2UrGtSoGwruWx6ocMQ6ey8uPZm2b`. Holds the 90B $PND vesting escrow (see the escrow vesting design). **Not funded** — `account_info` returns `actNotFound` on mainnet.
3. **Operations** — `rPNDAwFzgXzsjvUbVWz1ErB28v9SkcR2in`. Opens the $PND trust line, authorizes $rPND, holds the 10B distribution/liquidity inventory, and creates the AMM pool. **Not funded** — `account_info` returns `actNotFound` on mainnet.
4. **Bot-ops (recommended, not yet created)** — a dedicated fourth account for any automation that needs a signing key. **Never Operations, and never the Issuer or Treasury.** Operations holds the 10B liquidity allocation and must not double as the bot's wallet; a compromised bot key on Operations would put that allocation at risk. The recommended shape is a regular key on a new, bounded account funded with 5–10 XRP and no $PND trust line — see the bot custody design.

`npx tsx src/cli.ts fund` creates disposable faucet-funded issuer and operational wallets for **rehearsal only**, via `ISSUER_SEED` and `OPERATIONAL_SEED`. It has no concept of Treasury or bot-ops accounts; treat any rehearsal of those roles as a second faucet-funded "operational" wallet under a different name until the tooling is extended.

### One cold account, or two? — settled

**One.** The owner has confirmed that `rPNDRmfNNrUZstkA23haCUkCp7qLEPnaYc` issues both $PND and $rPND. `ISSUER_SEED` signing the $PND `AccountSet`/`Payment` and the $rPND `MPTokenIssuanceCreate` with the same key is therefore the intended design, not an inherited default that still needs a decision.

Verified live at the time of confirmation: the address is funded with 2.539034 XRP, `Flags` reads `0`, `OwnerCount` reads `0`, and no `AccountSet`, `Payment`, or `MPTokenIssuanceCreate` has ever been submitted from it. On testnet and devnet the address still returns `actNotFound` — rehearsal accounts must come from a network faucet and are disposable.

Sharing one account couples the two assets in ways that cannot be undone selectively:

- **Account flags are shared.** `AccountSet` is per account, not per asset. `asfDefaultRipple`, `asfRequireAuth`, `asfGlobalFreeze`, `asfNoFreeze`, and `asfAllowTrustLineClawback` apply to the account, so an IOU policy choice made for $PND also lands on anything else that account issues. Several of these are irreversible.
- **`Domain` is shared.** One account has one `Domain`, so both assets resolve to the same XLS-26 `xrp-ledger.toml` and the same operator identity.
- **Reserve and key exposure are shared.** Each `MPTokenIssuance` costs the issuer 0.2 XRP in owner reserve, and every holder's MPT balance is tracked in the issuer's owner directory too. One compromised or unusable cold key affects both assets at once.
- **Blast radius is shared.** `asfGlobalFreeze` on the account freezes all its IOUs together.

Note that MPT capability flags are per issuance and so are *not* shared — the coupling is on the IOU/account side.

#### The blackholing trap a shared issuer creates

A blackholed account can never sign again: no `AccountSet`, no `Payment`, no `MPTokenIssuanceCreate`. Because this issuer is shared, **if $rPND is ever going to exist, its `MPTokenIssuanceCreate` must be submitted before this issuer is ever blackholed** — never after. Blackholing first forecloses $rPND on this address permanently, with no recovery.

That ordering is moot in practice right now, because this repo's own committed $rPND config cannot be created on mainnet at all: it sets `ImmutableFlags` (to freeze `tfMPTCanClawback` permanently off), `ImmutableFlags` requires the **`DynamicMPT`** amendment, and `DynamicMPT` is **not enabled on mainnet**. Submitting the create as configured to a network that mirrors mainnet's amendment set (Testnet) returns `temDISABLED`; the identical transaction with `ImmutableFlags` removed returns `tesSUCCESS`.

So blackholing this issuer is blocked on two independent grounds: it must not happen before $rPND exists on this address (if $rPND is ever wanted at all), and separately, the $rPND config as currently written cannot even be created on mainnet, so there is nothing yet to sequence before a blackhole. Either of two things clears the second blocker: drop `ImmutableFlags` from the $rPND config (accepting "no clawback" as unenforced policy until `DynamicMPT` activates, not a ledger-frozen guarantee), or wait for `DynamicMPT` to activate on mainnet. Do not treat "blackhole once `Domain` is permanent" as sufficient by itself — check both conditions first.

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

**The topology is decided: two accounts, not one.** The owner has named Treasury (`rPNDcL2UrGtSoGwruWx6ocMQ6ey8uPZm2b`, holding the 90B vesting escrow) and Operations (`rPNDAwFzgXzsjvUbVWz1ErB28v9SkcR2in`, holding the 10B circulating allocation and creating the AMM pool) as separate accounts. Each needs its own `TrustSet` and its own `--limit` — `buildPndTrustSet` accepts a `limit` override, and `issue-pnd` accepts `--value`, so this works without a config change to the single-account default the CLI still assumes. Neither account is funded on ledger yet (`account_info` returns `actNotFound` for both on mainnet), so nothing above has actually run.

This is narrower than a full custody decision: it fixes the Treasury/Operations split, but leaves open whether Operations is further subdivided (e.g. a separate market-making account) or whether a fifth account is ever added for that. It does **not** answer bot custody — a bot must never hold Operations' key, since Operations carries the 10B liquidity allocation. Any bot automation gets its own bounded account, separate from all four named here; see the bot custody design.

## $rPND (MPT)

Requires an MPT-capable network. `MPTokensV1` is live on mainnet, Testnet, and Devnet; `config/tokens.json` now marks all three `supportsMpt: true` (the previous `false` for Testnet was stale).

1. `issue-rpnd` — `MPTokenIssuanceCreate` with XLS-89 metadata from `config/tokens.json`.
2. Unless `--create-only`, operational `MPTokenAuthorize` then issuer `Payment` of the MPT.
3. Persist `mpt_issuance_id` (also stored in `var/<network>-issuance.json`).

`AssetScale` and `MaximumAmount` are fixed for the life of the issuance. Review them before the create transaction.

**As configured, step 1 fails on mainnet.** `tifMPTCanClawback` is requested via `ImmutableFlags`, which needs `DynamicMPT`. Where the amendment is absent the create returns `temDISABLED`; where it is present, clawback is genuinely frozen off. The decision is to wait for the amendment or to create without the freeze and treat "no clawback" as policy rather than an on-ledger guarantee. Note that on a pre-`DynamicMPT` network no flag can be enabled afterwards either, so an unfrozen clawback flag cannot actually be switched on until the amendment lands — at which point it could be, unless frozen promptly.

**This same blocker gates blackholing the issuer, since the issuer is shared with $PND** — see [the blackholing trap a shared issuer creates](#the-blackholing-trap-a-shared-issuer-creates) above. Do not blackhole `rPNDRmfNNrUZstkA23haCUkCp7qLEPnaYc` before this create has succeeded, if $rPND is ever going to exist.

$rPND issuance is not on the $PND launch path; none of this blocks $PND.

## Metadata publication

1. `npx tsx src/cli.ts render-toml --issuer <cold-address> --domain <host>`
2. Serve the file at `https://<host>/.well-known/xrp-ledger.toml`
3. Re-run `configure-issuer --domain <host>` so the AccountRoot `Domain` matches

Explorers that implement XLS-26 will scrape that file. $rPND discovery also depends on the on-ledger XLS-89 blob.

## Mainnet

There is no faucet command on mainnet. Fund accounts independently, re-confirm amendment status against the live ledger, replace placeholder icon/URI/domain values, then submit the same transaction sequence with production seeds held outside this repo.

For $PND specifically, settle [the decisions that close at the first trust line](#decisions-that-close-at-the-first-trust-line) and the [distribution topology](#trust-limit-and-distribution-topology) before step 2 of the $PND sequence. For $rPND, resolve the `ImmutableFlags` / `DynamicMPT` position first, since the create cannot succeed on mainnet as configured.
