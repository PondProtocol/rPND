# $rPND tokenomics — decision draft

**Status: draft for decision. Nothing here is settled.** This document frames the choices and their consequences; it does not pick numbers. Every figure marked *illustrative* exists only to show how a mechanism behaves and is not a proposal.

$rPND is Pond Protocol's **reward token**. The premise of this document is that it is an MPT because rewards need things an IOU cannot do — so the design should start from those capabilities rather than treat the MPT as an implementation detail.

Capability claims below were checked against [XLS-33](https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0033-multi-purpose-tokens), the current xrpl.org MPT reference, and this repo's `src/issuance.ts` and `config/tokens.json`. Where sources disagree, that is called out rather than resolved by guesswork.

## 1. What $rPND is for

A reward asset has a job description that differs from a currency: it is **minted continuously in small amounts to many accounts**, it needs a reason to be held rather than immediately sold, and it needs the issuer to retain some control over abuse without holding a veto over honest holders' balances.

That shape drives three requirements, and each maps onto an MPT capability:

| Requirement | MPT capability |
| --- | --- |
| Distribute to many accounts in small units without per-holder credit setup | `AssetScale` + `MPTokenAuthorize` (no trust limit to size or maintain) |
| Optionally make rewards non-transferable (points, not currency) | `tfMPTCanTransfer` off — tokens can only return to the issuer |
| Hold a ledger-enforced ceiling rather than a promise | `MaximumAmount` |

### What the MPT gives that an IOU cannot

Verified against the MPT feature set:

- **Ledger-enforced supply ceiling.** `MaximumAmount` caps circulation. An IOU has no on-ledger cap at all; a supply figure for an IOU is issuer policy, enforced only by the issuer's own discipline. This is exactly the contrast with $PND, whose total supply the owner has set at 100,000,000,000 and which the `pnd` repo documents as issuer policy. For $rPND the equivalent number would be enforced by the protocol.
- **Native non-transferability.** With `tfMPTCanTransfer` off, holders can only send tokens back to the issuer. This makes genuine non-transferable reward points possible. An IOU has no equivalent: any holder with a trust line can pay any other holder, and the only blunt instrument is freezing.
- **Issuer-controlled on-ledger metadata.** `MPTokenMetadata` (≤1024 bytes, XLS-89) lives on the issuance and is mutable by the issuer via `MPTokenIssuanceSet` under the DynamicMPT amendment. An IOU's metadata is an `xrp-ledger.toml` file served over HTTPS — if the domain lapses, the identity goes with it.
- **A deflationary transfer fee.** 0–50% in increments of 0.001%, charged on top of the delivered amount. See §3 for the part that surprises people: the fee is **burned, not collected**.
- **Per-holder lock.** `tfMPTCanLock` (on for $rPND) lets the issuer lock one holder's balance or the whole issuance. Comparable to IOU freeze, but scoped per issuance rather than per trust line.
- **Allow-listing and permissioned domains.** `tfMPTRequireAuth` (off) gates who may hold. With it, `DomainID` can restrict holding to a credentialed permissioned domain.
- **Burn by payment.** Any holder sending $rPND to the issuer destroys it and reduces `OutstandingAmount`. No burn transaction type is needed, and no burn address convention is required.

Two corrections to framings that are easy to assume, both of which matter for design:

**Holders are not free of setup.** An MPT holder must submit `MPTokenAuthorize` to create an `MPToken` object, and that object costs them an incremental owner reserve in XRP — the same class of friction as a trust line. What disappears is the trust *limit*, the rippling flags, and the issuer-side `DefaultRipple` configuration, not the opt-in or the reserve. **Rewards cannot be pushed to an account that has not opted in.** Any "earn without signing up" flow is off the table unless the protocol pays for and orchestrates onboarding. With `tfMPTRequireAuth` enabled the ordering is also fixed: the holder must authorize first, then the issuer.

**Clawback is already permanently off for $rPND.** `config/tokens.json` sets `immutable.canClawback`, which puts `tifMPTCanClawback` in `ImmutableFlags` at create. Clawback is therefore not merely disabled but unreachable forever. If reward clawback — revoking tokens from a confirmed abuser — is wanted, **that is a blocking decision that must change the config before issuance.** It cannot be added later. See §2.

## 2. The immutability constraint

> [!IMPORTANT]
> This is the most consequential section. Several parameters can never be changed once `MPTokenIssuanceCreate` is validated, and capability flags move in one direction only. Emission design must fit inside these constraints, because the reverse is impossible.

### Permanent at creation — no transaction can ever change these

| Field | Consequence if wrong |
| --- | --- |
| `AssetScale` (currently `6`) | Reward granularity is fixed forever. Too coarse and micro-rewards round away; too fine and the supply ceiling shrinks (see below). |
| `MaximumAmount` (currently `1000000000000000`) | The circulation ceiling is fixed forever. It cannot be raised for a later emission phase, and cannot be lowered to tighten policy. |

Neither field appears on `MPTokenIssuanceSet`, and neither has an immutable flag — they are simply never mutable. Changing either means `MPTokenIssuanceDestroy` (possible only while `OutstandingAmount` is zero, i.e. every holder has returned every token) and a fresh create under a **new `MPTokenIssuanceID`**. For a live reward token with holders, treat both as unchangeable in practice.

**`AssetScale` and `MaximumAmount` compete for the same budget.** Balances are unsigned 64-bit, so base units cap at 2^63−1 = 9,223,372,036,854,775,807. Maximum expressible supply in display units is therefore `(2^63−1) / 10^AssetScale`:

| `AssetScale` | Max supply, display units |
| --- | --- |
| 0 | ~9.22 × 10^18 |
| 6 (current) | ~9.22 trillion |
| 9 | ~9.22 billion |
| 12 | ~9.22 million |

*Illustrative, to show the interaction:* a 100,000,000,000 supply — matching the figure the owner set for $PND — is comfortable at `AssetScale` 6, consuming about 1% of the budget. The same supply is **impossible** at `AssetScale` 9, because 10^20 base units exceeds the 64-bit ceiling. Decide scale and ceiling together, not separately.

### One-way flags — enable only, never disable

Capability flags can be turned on at create or later via `MPTokenIssuanceSet`, but **once enabled they cannot be disabled.** There is no `tfMPTClear...` operation. The current state of $rPND:

| Flag | Now | What is still possible |
| --- | --- | --- |
| `tfMPTCanTransfer` | **on** | Permanently on. $rPND can never be made non-transferable. |
| `tfMPTCanLock` | **on** | Permanently on. Issuer keeps lock power forever. |
| `tfMPTCanTrade` | off | Can be enabled later, then never revoked. |
| `tfMPTRequireAuth` | off | Can be enabled later, then never revoked. |
| `tfMPTCanEscrow` | off | Can be enabled later, then never revoked. |
| `tfMPTCanClawback` | off **and frozen** | Unreachable forever. |

Two implications worth absorbing. First, the "non-transferable reward points" option in §1 **is already foreclosed** by the current config — `tfMPTCanTransfer` is on at create and cannot be turned off. If non-transferable rewards are even a possibility worth preserving, the config must change before issuance. Second, `ImmutableFlags` is the only way to promise that an *off* flag stays off. Without freezing, "$rPND will never be allow-listed" is a statement about intent, not about the ledger.

### Mutable after creation

`MPTokenMetadata`, `TransferFee`, and `DomainID`, plus the lock/unlock state. Metadata and transfer fee are mutable *by default* but can each be frozen permanently (`tifMPTMetadata`, `tifMPTTransferFee`).

`ImmutableFlags` is additive and can be declared at create or later: each declaration adds to what is already fixed and can never be cleared. That allows the design to be settled in stages — for example, freezing metadata once production URLs are final while leaving the transfer fee open longer.

### Amendment dependencies

Worth verifying before a mainnet create, because the failure mode is a rejected transaction:

- **MPTokensV1** — MPTs at all. `config/tokens.json` already tracks this as `supportsMpt` per network.
- **DynamicMPT** — required for `ImmutableFlags`, and for mutating metadata or transfer fee. This repo's create sets `ImmutableFlags`, so **the current create transaction depends on DynamicMPT**, not on MPTokensV1 alone. Without it the transaction fails with `temDISABLED`.
- **PermissionedDomains + SingleAssetVault** — required for `DomainID`.
- **TokenEscrow** — required for escrow; escrowed balances appear in `LockedAmount` and stay counted in `OutstandingAmount`.

## 3. Supply and emission

### The cap does not mean what it looks like

`MaximumAmount` caps **`OutstandingAmount`, the amount in circulation — not cumulative lifetime issuance.** Because sending $rPND to the issuer burns it and decreases `OutstandingAmount`, burned supply becomes re-mintable headroom. The issuer can mint again up to the cap, indefinitely.

For a reward token this is the single most important mechanical fact in this document. A fixed `MaximumAmount` combined with sinks that return tokens to the issuer is **not** a fixed-emission system; it is a circulating-supply ceiling with a recycling loop. Long-run emission is then bounded by sink throughput, not by the cap. If the goal is a genuinely finite lifetime emission, the ledger will not enforce it — that has to be issuer policy, tracked off ledger, exactly like $PND's supply figure.

A related consequence: the issuer account **cannot hold its own MPT**. There is no "treasury balance" at the issuer; conceptually the issuer holds `MaximumAmount − OutstandingAmount`. A reward treasury must therefore be a separate operational account — which this repo already provisions — and moving tokens there counts as issuance into circulation.

### Options

**Option A — Fixed cap at creation, treasury pre-mint.** Set `MaximumAmount` to the intended total, mint the reward pool to the operational account, distribute from there.

- Circulating ceiling is credible and verifiable from the create transaction.
- Whole supply registers as `OutstandingAmount` immediately, so on-ledger "circulating supply" overstates what is actually in users' hands. Off-ledger reporting must explain the distinction.
- Treasury is a hot-key custody problem proportional to the pre-mint.

**Option B — Fixed cap, mint on demand.** Same cap; mint to earners (or to the operational account in tranches) as rewards are earned.

- `OutstandingAmount` tracks real distribution, so on-ledger supply is honest.
- Emission pace stays under issuer control without a cap change.
- Every distribution needs the issuing key, or a delegated tranche process. Operationally heavier and a live key-handling question.

**Option C — Omit `MaximumAmount`.** The field is optional; omitted, the ceiling defaults to 2^63−1.

- Maximum flexibility for an undecided emission curve.
- Forfeits the main reason to prefer an MPT for supply credibility. An effectively uncapped reward token is weaker on this axis than $PND, which at least has a stated policy number.
- Not recommended as a final state, though defensible for a Devnet rehearsal issuance.

**Option D — Deliberately oversized cap, policy-governed emission.** Set the cap well above intended supply as a safety ceiling; govern actual emission by policy.

- Removes the risk of the cap becoming a binding constraint on a curve that is still unknown.
- The cap stops communicating anything meaningful about supply; back to trusting policy.

The real question underneath these is whether the cap is meant as a **promise to holders** (Options A/B) or as a **guardrail against operator error** (Option D). That framing decision should precede the number.

### Emission shape

Independent of the cap, and all shapes are compatible with Options A, B, and D:

- **Constant rate** — simple, predictable, no early-adopter premium; dilutive without matching sink growth.
- **Decaying / halving** — rewards early participation, gives a declining issuance narrative; needs a decided decay parameter and creates cliff effects around each step.
- **Budgeted epochs** — a fixed pool per period split among participants, so cost is capped per epoch and reward-per-user floats with participation. Predictable for the issuer, unpredictable for the user.
- **Activity-indexed** — emission tracks a measured quantity. Best incentive alignment, hardest to make abuse-resistant, and the only shape where emission is not known in advance.

Transfer fee interacts here: because the fee burns, higher transfer volume slowly returns headroom under the cap. *Illustrative:* at `AssetScale` 6, a 0.1% fee on a 1,000-unit transfer burns 1 unit. Note also that the fee is charged **on top of** the delivered amount — the sender pays more, the receiver gets the stated amount — and small payments can round the fee away entirely. Rounding direction is a live discrepancy: the XLS-33 text describes round-half-up while the current xrpl.org reference says amounts are rounded down. Verify against the target rippled release before relying on fee revenue in any model. Also note the fee never applies to payments sent directly to the issuer, so burns and redemptions are fee-free.

## 4. Reward mechanics

All options. Nothing here is chosen.

### What earns $rPND

The honest blocker is that this depends on what the Protocol does, which the `protocol` repo does not yet define. Generic shapes: providing a measurable resource, holding or locking an asset over time, completing verifiable actions, or contributing usage that the protocol can price. The selection criterion that matters most is **whether the earning event is cheap to verify and expensive to fake** — that single property determines how much of the anti-farming section below is needed.

### Sinks and utility

A reward token with no sink is a sell-pressure generator. Available sinks, in rough order of how native they are to the MPT:

- **Burn for something.** Pay $rPND to the issuer for access, priority, upgrades, or fee discounts. Native: sending to the issuer burns and frees cap headroom.
- **Lock-ups.** Commit a balance for a period in exchange for a benefit. Requires `tfMPTCanEscrow` (currently off, enableable) plus the TokenEscrow amendment, or an off-ledger equivalent.
- **Transfer fee.** A passive, involuntary sink proportional to transfer activity. Not issuer revenue.
- **Fee payment in $rPND.** Protocol fees denominated in $rPND, collected to the issuer and thereby burned.
- **Conversion toward $PND.** Only if §5 concludes such a path should exist.

The design question is which sink is **load-bearing** — the one that has to work for the token to hold value — versus which are incidental. Picking more than one load-bearing sink usually means none of them gets built well.

### Anti-farming

Ordered from cheapest to most invasive, with the ledger-level cost of each:

1. **Make earning expensive to fake.** Cheapest and most effective, entirely a Protocol design question, no token flags needed.
2. **Per-account and per-epoch caps.** Off-ledger accounting; no MPT feature required.
3. **Sybil cost via the reserve.** Each `MPToken` costs the holder an XRP owner reserve, so every farmed identity carries a real cost. Modest but free, and it arrives automatically.
4. **Allow-listing.** `tfMPTRequireAuth` gates who can hold; `DomainID` gates by permissioned domain credential. Strong, but it makes the issuer a gatekeeper on every holder and adds the holder-authorizes-first ordering. One-way once enabled.
5. **Per-holder lock.** `tfMPTCanLock` is already on, so an abuser's balance can be frozen pending review. Available today, reversible per holder, and no config change needed.
6. **Clawback.** The only way to actually reclaim distributed tokens — **and it is permanently unavailable under the current config.** If reward clawback is wanted, `immutable.canClawback` must be reconsidered before issuance.

The tension to resolve deliberately: options 4 and 6 make the token safer for the issuer and less credible for holders. $rPND currently sits at the holder-friendly end (no allow-list, no clawback, clawback permanently foreclosed) with lock retained as the one enforcement tool. That is a defensible position, but it should be a chosen one rather than an inherited default.

## 5. Relationship to $PND

**No peg, ratio, or redemption is asserted here, and none exists on ledger.** $rPND's metadata carries `additional_info.paired_iou_currency = "PND"`, which is a documentation hint for indexers. The XRPL does not link an IOU to an MPT, enforce any ratio, or provide atomic conversion between them. Any relationship would be an off-ledger or Protocol-level policy that someone must operate.

What is settled: $PND is the IOU with a stated total supply of 100,000,000,000 as issuer policy, documented in the `pnd` repo; $rPND is the MPT and the reward token; both are issued from the same cold account; the parameters for both live in this repo's `config/tokens.json`.

Open, and genuinely undecided:

- **Does a conversion path exist at all?** A reward token that converts into the primary asset inherits that asset's monetary expectations, and every conversion becomes a claim on someone. A reward token with no conversion path must earn its value purely from utility.
- **If it exists, which direction?** One-way $rPND → $PND is a redemption, and implies something backing it. One-way $PND → $rPND is closer to a subscription. Bidirectional is a market-making commitment.
- **At what rate, and who sets it?** Fixed, floating, or discretionary. A fixed rate is a peg in substance whatever it is called, and pegs need reserves and a defense policy.
- **Who operates it?** A protocol contract, an operational account, or a venue. This is an ongoing operational and custody obligation, not a one-time setup.
- **Which token is primary user-facing?** If $PND is primary and $rPND is the earn-side asset, $rPND needs a reason to be held rather than immediately converted. If $rPND is primary, $PND's role needs restating. The `pnd` repo currently documents $PND for holders and integrators, which implies $PND is primary — but that has not been decided explicitly.

Until these are settled, nothing in this repo or in `pnd` should describe $rPND as redeemable, backed, or pegged.

## 6. Decisions for the owner

### Blocking before issuance

Permanent or one-way on ledger. Getting one wrong means a new `MPTokenIssuanceID`, which for a live token with holders is not a real option.

| # | Decision | Why it blocks |
| --- | --- | --- |
| 1 | **`AssetScale`** — keep `6`? | Permanent. Sets reward granularity and caps maximum expressible supply. |
| 2 | **`MaximumAmount`** — a number, or omit? | Permanent. Cannot be raised or lowered afterwards. |
| 3 | **Is the cap a promise or a guardrail?** | Determines what number to pick in #2 and what may be claimed publicly. |
| 4 | **Clawback: keep permanently off?** | `tifMPTCanClawback` is set in the current config. Off is unreachable-forever, so reward clawback must be decided *now* or never. |
| 5 | **Transferable, or non-transferable points?** | `tfMPTCanTransfer` is on at create and can never be turned off. Non-transferable rewards require a config change before issuance. |
| 6 | **Freeze any other flags with `ImmutableFlags`?** | Freezing is the only way to promise an off flag stays off. Can be done later, but only while still off — so in practice it is a pre-issuance decision per flag. |
| 7 | **Confirm DynamicMPT on the target network.** | The current create sets `ImmutableFlags` and fails with `temDISABLED` without it. |
| 8 | **Who holds the reward treasury, and how is it keyed?** | The issuer cannot hold its own MPT. Option A vs B changes the custody model and how often the cold key is used. |

### Safe to defer

Changeable later on ledger, or purely off-ledger policy.

| # | Decision | Notes |
| --- | --- | --- |
| 9 | Emission shape and rate | Off-ledger policy under Options A, B, and D. |
| 10 | What earns $rPND | Depends on the Protocol; blocked on `protocol`, not on issuance. |
| 11 | Which sink is load-bearing | Can start with burn-to-issuer, which needs no flags. |
| 12 | `TransferFee` value | Mutable by default; requires `tfMPTCanTransfer`, which is already on. |
| 13 | Enable `tfMPTCanTrade` for DEX/AMM | Enableable later, never revocable. Easy to defer: xrpl.org notes DEX trading of MPTs is **not currently implemented**, so enabling it today would have no effect. |
| 14 | Enable `tfMPTCanEscrow` for lock-ups | Enableable later; also needs TokenEscrow. |
| 15 | Allow-listing via `tfMPTRequireAuth` / `DomainID` | Enableable later, never revocable. Adds gatekeeping and the holder-first ordering. |
| 16 | Metadata: icon, URIs, `issuer_name` | Mutable unless frozen with `tifMPTMetadata`. Still placeholders. |
| 17 | $PND ↔ $rPND conversion policy | Off-ledger. Needs an operator before it can exist. |
| 18 | Which token is primary user-facing | Documentation and product decision. |
| 19 | Anti-farming caps and verification | Off-ledger; iterate after launch. |

Item 4 deserves the most attention. It is the one decision on this list that is both permanent and currently pre-answered by a config default rather than by an explicit choice.

## Related

- [`rpnd-spec.md`](rpnd-spec.md) — what the issuance actually is today, and which fields are fixed
- [`mpt-vs-iou.md`](mpt-vs-iou.md) — the primitive comparison in more detail
- [`issuance.md`](issuance.md) — the operational sequence
