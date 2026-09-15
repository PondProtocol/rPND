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
| `MPTokensV2` | **not enabled** | MPT DEX and AMM support. Until it activates, $rPND cannot trade anywhere; $PND as an IOU can. |

Amendment status is a point-in-time observation. Re-check it against the live ledger before any mainnet operation. `config/tokens.json` tracks only `supportsMpt` per network, which is necessary but not sufficient — it does not model `DynamicMPT`.

## Accounts

XRPL IOU practice is two keys:

1. **Issuer (cold)** — `AccountSet` + issues $PND + creates $rPND. Keep this seed offline in production.
2. **Operational (hot)** — opens the $PND trust line, authorizes $rPND, holds inventory for distribution.

`npx tsx src/cli.ts fund` creates both via the network faucet and writes `var/<network>-wallets.json`. Copy seeds into `.env` as `ISSUER_SEED` and `OPERATIONAL_SEED`.

### One cold account or two?

This tooling assumes a **single** cold account issues both assets: `ISSUER_SEED` signs the $PND `AccountSet` and `Payment` as well as the $rPND `MPTokenIssuanceCreate`. That is an inherited default, not a decision.

The owner has designated `rPNDRmfNNrUZstkA23haCUkCp7qLEPnaYc` as the **$PND issuer**. It is **not** assigned as the $rPND issuer, and `rpnd-spec.md` deliberately still lists the $rPND issuer as TODO.

The account is **funded but entirely unconfigured**: `Flags` is `0` with all fifteen account flags false, `OwnerCount` is `0`, and `account_lines` and `account_objects` are both empty. Read it yourself rather than trusting a figure here — balances, sequence numbers, and ledger indexes all move, so this repo does not pin them:

```bash
curl -sS -X POST https://xrplcluster.com -H 'Content-Type: application/json' \
  -d '{"method":"account_info","params":[{"account":"rPNDRmfNNrUZstkA23haCUkCp7qLEPnaYc","ledger_index":"validated"}]}'
curl -sS -X POST https://xrplcluster.com -H 'Content-Type: application/json' \
  -d '{"method":"account_objects","params":[{"account":"rPNDRmfNNrUZstkA23haCUkCp7qLEPnaYc","ledger_index":"validated"}]}'
```

What to check, and why each matters:

| Field | Expect while unconfigured | Why it matters |
| --- | --- | --- |
| `OwnerCount` / `account_objects` | `0` / empty | An empty owner directory is what keeps the clawback window open. Also independently confirms no `MPTokenIssuance` exists from this account |
| `Flags` | `0` | **`asfDefaultRipple` is not set.** Beyond letting balances move between holders, it is a hard prerequisite for an AMM: `AMMCreate` fails with `terNO_RIPPLE` without it |
| `Domain` | absent | The XLS-26 two-way link under [Metadata publication](#metadata-publication) does not exist yet |
| `RegularKey` | absent | See custody below |

**Custody today is a single master seed.** There is no `RegularKey` and the master key is enabled, so one seed controls the account outright. The obvious hardening — a `SignerList` for multi-signature custody — **creates an owner object**, and a non-empty owner directory permanently closes the `asfAllowTrustLineClawback` window. So custody hardening and the clawback decision are ordered with respect to each other: decide clawback first, or lose it. `SetRegularKey` creates no owner object and is safe at any point, which makes it the one custody improvement with no ordering constraint. See [Decisions that close at the first trust line](#decisions-that-close-at-the-first-trust-line).

> [!IMPORTANT]
> **This is a $PND blocker, not an $rPND one.** The coupling runs in the direction that is easy to get backwards: flags, `Domain`, and blackholing are all properties of the *account*, not of an asset. So if one account issues both, every $rPND decision constrains $PND — and $rPND has not been designed yet. Deciding this is therefore on the $PND critical path, even though $rPND is deferred.

If one account issues both, the two assets are coupled in ways that cannot be undone selectively:

- **Account flags are shared.** `AccountSet` is per account, not per asset. `asfDefaultRipple`, `asfRequireAuth`, `asfGlobalFreeze`, `asfNoFreeze`, and `asfAllowTrustLineClawback` apply to the account, so an IOU policy choice made for $PND also lands on anything else that account issues. Several of these are irreversible.
- **`Domain` is shared.** One account has one `Domain`, so both assets resolve to the same XLS-26 `xrp-ledger.toml` and the same operator identity.
- **Reserve and key exposure are shared.** Each `MPTokenIssuance` costs the issuer 0.2 XRP in owner reserve, and every holder's MPT balance is tracked in the issuer's owner directory too. One compromised or unusable cold key affects both assets at once.
- **Blast radius is shared.** `asfGlobalFreeze` on the account freezes all its IOUs together.
- **Blackholing is shared and terminal.** Blackholing the account after the $PND launch would permanently end its ability to create an MPT. If this address is meant to issue $rPND, then "blackhole" is not available as a $PND decision at all.

Note that MPT capability flags are per issuance and so are *not* shared — the coupling is on the IOU/account side. Using a separate cold account for $rPND would decouple all of the above at the cost of a second key to custody and a second `Domain` or a shared one by convention.

TODO (owner): decide whether $rPND is issued from this same account or a separate one, **before the $PND flag decisions below.** Given that $rPND is deferred, a separate account for it is the reading that keeps the $PND decisions independent. Answering this also clears the issuer TODO in [`rpnd-spec.md`](rpnd-spec.md).

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
| `asfAllowTrustLineClawback` (16) | Only settable while the owner directory is **empty** — no trust lines, offers, escrows, payment channels, checks, or signer lists. Cannot be reverted once set. Requires the Clawback amendment. | $PND can **never** be clawed back. Permanent. |
| `asfRequireAuth` (2) | Only settable while the account has no trust lines. | $PND can never be made allow-list only. |
| `asfNoFreeze` (6) | Can never be disabled once enabled. Must be signed with the master key pair. | Retaining freeze power is the default; giving it up stays available later, but only in one direction. |
| `asfAllowTrustLineLocking` (17) | Cannot be disabled once enabled. Requires the TokenEscrow amendment. | $PND cannot be placed in escrow. |

The issuer's `OwnerCount` is `0` today, so all four are open. The window for the first two closes the moment step 2 runs.

**Two traps in this table that are easy to miss.**

*The clawback window closes on any owner object, not just a trust line.* Reproduced on Testnet: `SignerListSet` followed by `SetFlag: 16` returns **`tecOWNERS`**, exactly as a trust line does. So **hardening the cold issuer with multi-signature custody before deciding clawback silently forecloses clawback forever** — a sensible-looking security step that quietly spends a one-way decision. Any custody change that creates a `SignerList` must come *after* the clawback `AccountSet`. `SetRegularKey` creates no owner object and is safe at any point.

*Clawback and `asfNoFreeze` are mutually exclusive.* They are one decision with three outcomes, not two independent flags. Reproduced on Testnet in both directions, each returning **`tecNO_PERMISSION`** when the other is already set:

| Outcome | Can claw back | Can freeze | Still open later |
| --- | --- | --- | --- |
| Set clawback | Yes, permanently | Individual and global freeze remain | No |
| Set `asfNoFreeze` | Never | Individual freeze gone; a global freeze could be started but never lifted | No |
| Set neither (current state) | Never | Individual and global freeze remain | `asfNoFreeze` stays available |

"Set neither" is the only outcome that keeps a future option open, and it is where the account sits now. That is a legitimate choice rather than an absence of one — but it is only *open* until the first owner object exists, after which clawback is gone and only the `asfNoFreeze` half remains decidable.

TODO (owner): decide clawback and allow-listing for $PND **before** the first `TrustSet` on mainnet, and before any multi-sig custody setup. Clawback is the mirror image of the $rPND decision — for the MPT it is set at issuance create, for the IOU before the first owner object, and in both cases it is one-way. `configure-issuer` supports none of these flags today, and `SetFlag` carries only one value per transaction, so each needs its own `AccountSet`.

### Trust limit and distribution topology

A trust line limit is the maximum the *holder* is willing to accept from the issuer, so the operational account cannot receive more $PND than its own limit allows.

`pnd.operationalTrustLimit` is now `100000000000`, matching the 100,000,000,000 total supply the owner set for $PND and documented in the `pnd` repo. It was previously `1000000000` — one hundredth of that — which meant a single operational account could not take delivery of full supply. Unlike the MPT's `AssetScale` and `MaximumAmount`, a trust limit is not permanent: the holder can raise or lower it with another `TrustSet` at any time, so this is a safe default rather than a commitment.

> [!WARNING]
> **An undersized limit is worse than a failed payment.** Reproduced on Testnet: a `TrustSet` with limit 1,000,000,000 succeeds, and a `Payment` of 100,000,000,000 against it then returns **`tecPATH_PARTIAL`**. Because `tec` codes are *included in a validated ledger*, that outcome **consumes the issuer's sequence number** and burns the fee. In an offline batch-signing session — where several transactions are pre-signed with consecutive sequence numbers — the failure does not simply stop at the bad payment: every subsequent pre-signed blob is now numbered wrongly and must be re-signed, which means another trip to the air-gapped signer. Raising the limit first avoids a broken signing batch, not just a rejected payment.

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

This is the highest-leverage discovery step available, because it is crawled rather than applied for. XRPL Meta scans every issuing account that has a `Domain` set, fetches and parses its `xrp-ledger.toml`, and serves the result to Xaman, Crossmark, GemWallet, XRP Toolkit and the Xaman DEX. One file plus one `AccountSet` propagates the name, icon, description, asset class and links across all of them, with no per-wallet outreach.

Requirements that are easy to get wrong, and that fail silently:

- Path is exactly `/.well-known/xrp-ledger.toml`, lowercase, over **HTTPS** with a CA-signed certificate.
- Serve `Access-Control-Allow-Origin: *` for that path, with Content-Type `application/toml`.
- The issuer's `Domain` must match the serving host **exactly**, including any `www.`, and is stored on ledger as hex of the **lowercase** ASCII. `domainToHex` in `src/metadata.ts` lower-cases before encoding for exactly this reason, and `render-toml` lower-cases the domain it writes.
- `icon` values must carry a protocol prefix (`https://` or `ipfs://`).

Neither half of the link proves anything alone — anyone can host a file claiming an account, and any account can set `Domain` to any string. It is the match that is evidence.

Verify the result before relying on it:

```
GET https://s1.xrplmeta.org/v2/token/PND:<issuer-address>
```

$rPND discovery is different: an MPT's authoritative metadata is the on-ledger XLS-89 blob, so the TOML stanza for it is only a convenience for XLS-26 consumers.

## Mainnet

There is no faucet command on mainnet. Fund accounts independently, re-confirm amendment status against the live ledger, replace placeholder icon/URI/domain values, then submit the same transaction sequence with production seeds held outside this repo.

For $PND specifically, settle [the decisions that close at the first trust line](#decisions-that-close-at-the-first-trust-line) and the [distribution topology](#trust-limit-and-distribution-topology) before step 2 of the $PND sequence. For $rPND, resolve the `ImmutableFlags` / `DynamicMPT` position first, since the create cannot succeed on mainnet as configured.
