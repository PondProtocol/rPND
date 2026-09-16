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
| `asfNoFreeze` (6) | Can never be disabled once enabled. Must be signed with the master key pair. Permanently mutually exclusive with `asfAllowTrustLineClawback` — enabling either forecloses the other with `tecNO_PERMISSION`. | Retaining freeze power is the default; giving it up stays available later, but only in one direction. |
| `asfAllowTrustLineLocking` (17) | **Reversible**, and has no deadline — see the correction below. Requires the TokenEscrow amendment. | $PND cannot be placed in escrow until this is set. |

Because the designated $PND issuer does not exist on any network yet, all four are still open. The window for the first two closes the moment step 2 runs.

> [!NOTE]
> **Correction:** an earlier version of this table said `asfAllowTrustLineLocking` "cannot be disabled once enabled," inherited from xrpl.org's own `AccountSet` reference page. That statement is wrong. Verified directly on Testnet: `ClearFlag: 17` returns `tesSUCCESS`, including on an issuer with live trust lines and live escrows outstanding. Unlike clawback and `asfRequireAuth`, this flag has no owner-directory deadline either — it can be set after the first trust line, and after escrows already exist. It is not a now-or-never decision. (Clearing it is not a kill switch, though: it only blocks *new* escrows of this currency, and has no effect on ones that already exist.)

`issuer-flag` and `issuer-flag-sequence` (below) build the `AccountSet` for any of these four flags, plus `asfDefaultRipple`; none of them was expressible before.

TODO (owner): decide clawback and allow-listing for $PND **before** the first `TrustSet` on mainnet. Clawback in particular is the mirror image of the $rPND decision — for the MPT it is set at issuance create, for the IOU it is set before the first trust line, and in both cases it is one-way.

## Issuer flags: `issuer-flag` and `issuer-flag-sequence`

`buildIssuerAccountSet` in `src/issuance.ts` used to hard-assign `SetFlag: asfDefaultRipple` with no parameter — since `SetFlag` carries exactly one value per transaction, it could never express clawback, `asfRequireAuth`, `asfNoFreeze`, or the escrow-locking flag. It now accepts an optional `flag` override, and `buildIssuerFlagAccountSet` builds a clean, standalone `AccountSet` for any one of them:

```bash
# A single standalone AccountSet for one flag.
npx tsx src/cli.ts issuer-flag --flag allow-trust-line-locking
npx tsx src/cli.ts issuer-flag --flag allow-trust-line-clawback
npx tsx src/cli.ts issuer-flag --flag no-freeze
npx tsx src/cli.ts issuer-flag --flag require-auth
npx tsx src/cli.ts issuer-flag --flag allow-trust-line-locking --mode clear

# The full ordered batch for a chosen configuration — clawback and
# RequireAuth first (both close at the first trust line), then the main
# configure-issuer transaction, then NoFreeze, then trust-line locking.
npx tsx src/cli.ts issuer-flag-sequence --clawback --no-freeze --allow-trust-line-locking
```

Before submitting `allowTrustLineClawback` or `noFreeze`, both commands re-check the *live* ledger: the owner directory via `account_objects` — never `OwnerCount`, which stays `0` even once a holder's trust line (or an escrow of this issuer's currency) has already closed the clawback window — and the opposing flag's live state, for either. A configuration that requests both `--clawback` and `--no-freeze` is refused before any network call, since the two are permanently mutually exclusive.

Every `issuer-flag*` command accepts `--prepare`: it connects, autofills `Account`/`Sequence`/`Fee`/`LastLedgerSequence` from live network state, and prints the still-unsigned transaction (or, for `issuer-flag-sequence`, the whole batch with consecutive `Sequence` numbers) for an offline signer. No seed is read in that mode. On mainnet, no seed is ever read for any command — see [Mainnet](#mainnet).

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

## Escrow (vesting)

For an issued currency (an IOU like $PND) to be escrowable at all, its issuer needs `asfAllowTrustLineLocking` set — see [Issuer flags](#issuer-flags-issuer-flag-and-issuer-flag-sequence). Without it, every `EscrowCreate` of that currency fails `tecNO_PERMISSION`. `escrow-create`/`escrow-finish`/`escrow-cancel`/`escrow-schedule` all check this live precondition (and that `TransferRate` reads `0` — it is snapshotted into the escrow at creation and corrupts amounts otherwise) before building or submitting anything.

**The issuer can never escrow its own currency** — `tecNO_PERMISSION`, verified, even with the locking flag set. A separate account (a "treasury") has to hold and escrow the currency. `buildEscrowCreate` refuses client-side to build a transaction where `Account` is also the amount's `issuer`, to save a wasted fee on a transaction that would fail anyway.

```bash
# One escrow, for an issued currency, defaulting to a self-escrow
# (Destination = the sending account) — the shape that makes permissionless
# release harmless, since the funds just become spendable by the sender again.
npx tsx src/cli.ts escrow-create --issuer <coldIssuer> --value 9000000000 --finish-after 2027-01-01T00:00:00Z
npx tsx src/cli.ts escrow-create --issuer <coldIssuer> --value 100 --to <otherAccount> --finish-after 2027-06-01T00:00:00Z --cancel-after 2027-07-01T00:00:00Z

# Anyone may finish or cancel once due — releases are permissionless.
npx tsx src/cli.ts escrow-finish --owner <treasury> --offer-sequence 12345
npx tsx src/cli.ts escrow-cancel --owner <treasury> --offer-sequence 12345

# The dated-tranche vesting schedule: ten 9B-PND tranches, monthly from
# 2027-01-01, FinishAfter only, self-escrowed by default. Every number is
# an override, not a decision this tooling makes for you.
npx tsx src/cli.ts escrow-schedule --issuer <coldIssuer>
npx tsx src/cli.ts escrow-schedule --issuer <coldIssuer> --count 1 --tranche-value 5000000000 --start 2028-03-01T00:00:00Z # a later top-up

# Live escrows for an account, plus the corrected supply figure.
npx tsx src/cli.ts escrow-status --owner <treasury> --issuer <coldIssuer>
```

**A top-up is not a special operation.** Once a tranche is finished, there is no way to reopen it or claw tokens back into it — the only way to "move tokens back into escrow" is a fresh `EscrowCreate`, and a new escrow never resizes or merges with an existing one. `escrow-create` (or `escrow-schedule --count 1`) *is* the top-up mechanism: run it again with a new date and amount.

**Sequence capture.** Each `EscrowCreate`'s `Sequence` becomes the `OfferSequence` an `EscrowFinish`/`EscrowCancel` needs, possibly months later. `escrow-create` and `escrow-schedule` record it in `var/<network>-issuance.json` the moment the create succeeds. If that file is ever lost, `escrow-status` (via `listEscrows` in `src/escrow.ts`) rebuilds the list from `account_objects` on the owner — every live `Escrow` object is still there until it resolves.

**Supply reporting.** `gateway_balances` `obligations` excludes escrowed amounts entirely — verified: with some issued supply escrowed, `obligations` reports only what is unescrowed. The true issued supply is `obligations + sum of escrowed amounts`, and `escrow-status --issuer <coldIssuer>` computes exactly that by scanning the *issuer's* `account_objects` for `Escrow` entries in its currency (escrows link into the issuer's owner directory regardless of who created them, and cost the issuer no reserve).

Every escrow command accepts `--prepare` — same as `issuer-flag` above, no seed, ever, and none for mainnet under any circumstances.

## Metadata publication

1. `npx tsx src/cli.ts render-toml --issuer <cold-address> --domain <host>`
2. Serve the file at `https://<host>/.well-known/xrp-ledger.toml`
3. Re-run `configure-issuer --domain <host>` so the AccountRoot `Domain` matches

Explorers that implement XLS-26 will scrape that file. $rPND discovery also depends on the on-ledger XLS-89 blob.

## Mainnet

There is no faucet command on mainnet. Fund accounts independently, re-confirm amendment status against the live ledger, replace placeholder icon/URI/domain values, then submit the same transaction sequence with production seeds held outside this repo.

**No command in this toolkit will build a mainnet signing wallet from a seed, ever — not from an env var, not from a `--*-seed` flag.** `walletFromSeed`/`optionalWallet` in `src/runtime.ts` refuse outright when the resolved network is `mainnet`. The only way to get a mainnet transaction out of this repo is `--prepare`: every signing command accepts it, connects, autofills `Account`/`Sequence`/`Fee`/`LastLedgerSequence` from live network state (`client.autofill`, which needs no wallet), and prints the still-unsigned transaction for an offline signer. Sign it there; this repo never sees the seed.

For $PND specifically, settle [the decisions that close at the first trust line](#decisions-that-close-at-the-first-trust-line) and the [distribution topology](#trust-limit-and-distribution-topology) before step 2 of the $PND sequence. For $rPND, resolve the `ImmutableFlags` / `DynamicMPT` position first, since the create cannot succeed on mainnet as configured. For escrow, see [Escrow (vesting)](#escrow-vesting).
