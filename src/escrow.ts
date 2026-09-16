import {
  isoTimeToRippleTime,
  LedgerEntry,
  rippleTimeToISOTime,
  type Client,
  type EscrowCancel,
  type EscrowCreate,
  type EscrowFinish,
} from "xrpl";
import type { IssuedAmount } from "./types.ts";

type Escrow = LedgerEntry.Escrow;

/**
 * `FinishAfter`/`CancelAfter` accept seconds since the Ripple epoch
 * (2000-01-01T00:00:00Z). Callers may pass that directly as a `number`, or
 * an ISO-8601 string / `Date`, which is converted for them. This is purely
 * a convenience for callers — nothing here decides *when* a tranche should
 * release.
 */
export type EscrowTime = number | string | Date;

export function toRippleTime(value: EscrowTime): number {
  if (typeof value === "number") return value;
  return isoTimeToRippleTime(value instanceof Date ? value.toISOString() : value);
}

export function rippleTimeToIso(value: number): string {
  return rippleTimeToISOTime(value);
}

/**
 * Build an `EscrowCreate` for an issued currency (or XRP/MPT — `Amount`
 * accepts any of them). Requires at least one of `finishAfter`/`cancelAfter`,
 * matching the protocol's own requirement. Neither is defaulted: whether to
 * include a `CancelAfter` at all is the caller's decision, not this
 * builder's — see the vesting design's reasoning for using `FinishAfter`
 * only, which this function does not bake in.
 *
 * Refuses to build a transaction where the sender is also the issuer of the
 * amount being escrowed. That combination always fails on-ledger with
 * `tecNO_PERMISSION` — an issuer can never escrow its own currency — so
 * this is a protocol invariant, not a policy choice, and catching it here
 * saves a wasted fee and a consumed sequence number.
 */
export function buildEscrowCreate(params: {
  account: string;
  destination: string;
  amount: IssuedAmount | string;
  finishAfter?: EscrowTime;
  cancelAfter?: EscrowTime;
  condition?: string;
  destinationTag?: number;
  sourceTag?: number;
}): EscrowCreate {
  if (params.finishAfter === undefined && params.cancelAfter === undefined) {
    throw new Error("EscrowCreate needs at least one of finishAfter or cancelAfter.");
  }
  if (typeof params.amount === "object" && params.amount.issuer === params.account) {
    throw new Error(
      `Refusing to build EscrowCreate: Account (${params.account}) is also the issuer of the escrowed currency. ` +
        "An issuer can never escrow its own currency (tecNO_PERMISSION on ledger, verified). Escrow from a " +
        "separate account that holds the currency instead.",
    );
  }

  const tx: EscrowCreate = {
    TransactionType: "EscrowCreate",
    Account: params.account,
    Destination: params.destination,
    Amount: params.amount,
  };
  if (params.finishAfter !== undefined) tx.FinishAfter = toRippleTime(params.finishAfter);
  if (params.cancelAfter !== undefined) tx.CancelAfter = toRippleTime(params.cancelAfter);
  if (params.condition) tx.Condition = params.condition;
  if (params.destinationTag !== undefined) tx.DestinationTag = params.destinationTag;
  if (params.sourceTag !== undefined) tx.SourceTag = params.sourceTag;
  return tx;
}

export function buildEscrowFinish(params: {
  account: string;
  owner: string;
  offerSequence: number | string;
  condition?: string;
  fulfillment?: string;
}): EscrowFinish {
  const tx: EscrowFinish = {
    TransactionType: "EscrowFinish",
    Account: params.account,
    Owner: params.owner,
    OfferSequence: params.offerSequence,
  };
  if (params.condition) tx.Condition = params.condition;
  if (params.fulfillment) tx.Fulfillment = params.fulfillment;
  return tx;
}

export function buildEscrowCancel(params: {
  account: string;
  owner: string;
  offerSequence: number | string;
}): EscrowCancel {
  return {
    TransactionType: "EscrowCancel",
    Account: params.account,
    Owner: params.owner,
    OfferSequence: params.offerSequence,
  };
}

/** One tranche of a dated vesting schedule: a fixed amount and release date. */
export interface VestingTrancheSpec {
  value: string;
  finishAfter: EscrowTime;
  cancelAfter?: EscrowTime;
}

/**
 * Compute `count` monthly-spaced ISO-8601 dates starting at `startIso`, for
 * generating a dated tranche schedule. Pure date arithmetic — every value
 * (count, start date, interval) is a parameter, nothing is hardcoded.
 */
export function monthlyTrancheDates(params: {
  count: number;
  startIso: string;
  intervalMonths?: number;
}): string[] {
  if (params.count < 1) throw new Error("count must be at least 1.");
  const interval = params.intervalMonths ?? 1;
  const start = new Date(params.startIso);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid startIso: ${params.startIso}`);
  }
  const dates: string[] = [];
  for (let i = 0; i < params.count; i++) {
    const next = new Date(start);
    next.setUTCMonth(next.getUTCMonth() + i * interval);
    dates.push(next.toISOString());
  }
  return dates;
}

/**
 * Defaults matching the vesting design's recommendation (ten 9B PND
 * tranches, monthly from 2027-01-01, `FinishAfter` only). These are
 * defaults, not hardcoded behaviour: every field below is overridable in
 * `buildVestingSchedule`, so a different amount, count, currency, or start
 * date is just a different set of arguments to the same function.
 */
export const DEFAULT_VESTING_SCHEDULE = {
  count: 10,
  trancheValue: "9000000000",
  startIso: "2027-01-01T00:00:00.000Z",
  intervalMonths: 1,
  currency: "PND",
} as const;

/**
 * Build the ordered array of `EscrowCreate` transactions for a dated
 * tranche schedule. Defaults to the recommended shape — self-escrow
 * (`Destination` defaults to `treasuryAddress`, per the design's §6.2
 * finding that this is what makes permissionless release harmless), no
 * `CancelAfter`, no `Condition` — but every one of those is an override,
 * not a constraint this function enforces.
 *
 * Adding a later top-up is not a special operation: call
 * `buildEscrowCreate` (or this same function with `count: 1`) again with a
 * new date/amount. A new escrow can only ever add to what is locked, never
 * resize an existing one — that is a protocol fact, not a limitation of
 * this tooling.
 */
export function buildVestingSchedule(params: {
  treasuryAddress: string;
  issuerAddress: string;
  currency?: string;
  destination?: string;
  count?: number;
  trancheValue?: string;
  startIso?: string;
  intervalMonths?: number;
  cancelAfter?: EscrowTime;
}): EscrowCreate[] {
  const count = params.count ?? DEFAULT_VESTING_SCHEDULE.count;
  const trancheValue = params.trancheValue ?? DEFAULT_VESTING_SCHEDULE.trancheValue;
  const startIso = params.startIso ?? DEFAULT_VESTING_SCHEDULE.startIso;
  const intervalMonths = params.intervalMonths ?? DEFAULT_VESTING_SCHEDULE.intervalMonths;
  const currency = params.currency ?? DEFAULT_VESTING_SCHEDULE.currency;
  const destination = params.destination ?? params.treasuryAddress;

  const dates = monthlyTrancheDates({ count, startIso, intervalMonths });
  return dates.map((iso) =>
    buildEscrowCreate({
      account: params.treasuryAddress,
      destination,
      amount: { currency, issuer: params.issuerAddress, value: trancheValue },
      finishAfter: iso,
      ...(params.cancelAfter !== undefined ? { cancelAfter: params.cancelAfter } : {}),
    }),
  );
}

/** A live `Escrow` ledger object, decoded for reporting. */
export interface LiveEscrow {
  owner: string;
  destination: string;
  amount: unknown;
  offerSequence?: number;
  index: string;
  finishAfter?: string;
  cancelAfter?: string;
  condition?: string;
  releasableNow: boolean;
  expired: boolean;
}

/**
 * List every live `Escrow` object owned by `owner` (i.e. every escrow it
 * created that has not yet been finished or cancelled — those disappear
 * from `account_objects` once resolved). This is also most of the recovery
 * path for a lost `OfferSequence` record: rippled versions that support the
 * `seq` field on the raw `Escrow` ledger entry echo the creating
 * transaction's `Sequence` directly, in which case `offerSequence` is
 * filled in here; older/other servers omit it, in which case the object's
 * own `index` is still returned so it can be cross-referenced against a
 * `Sequence` recorded in `var/<network>-issuance.json` at creation time —
 * which is the reason `escrow-schedule` and `escrow-create` persist that
 * record proactively rather than relying on this lookup alone.
 */
export async function listEscrows(client: Client, owner: string): Promise<LiveEscrow[]> {
  const nowRipple = isoTimeToRippleTime(new Date().toISOString());
  const results: LiveEscrow[] = [];
  let marker: unknown;
  do {
    const response = await client.request({
      command: "account_objects",
      account: owner,
      ledger_index: "validated",
      type: "escrow",
      limit: 400,
      ...(marker !== undefined ? { marker } : {}),
    });
    for (const object of response.result.account_objects) {
      if (object.LedgerEntryType !== "Escrow") continue;
      const entry = object as Escrow & { index?: string; seq?: number };
      results.push({
        owner: entry.Account,
        destination: entry.Destination,
        amount: entry.Amount,
        ...(entry.seq !== undefined ? { offerSequence: entry.seq } : {}),
        index: entry.index ?? "",
        ...(entry.FinishAfter !== undefined ? { finishAfter: rippleTimeToIso(entry.FinishAfter) } : {}),
        ...(entry.CancelAfter !== undefined ? { cancelAfter: rippleTimeToIso(entry.CancelAfter) } : {}),
        ...(entry.Condition ? { condition: entry.Condition } : {}),
        releasableNow: entry.FinishAfter !== undefined ? entry.FinishAfter <= nowRipple : true,
        expired: entry.CancelAfter !== undefined ? entry.CancelAfter <= nowRipple : false,
      });
    }
    marker = response.result.marker;
  } while (marker !== undefined);
  return results;
}

/**
 * The corrected $PND-style supply formula from the vesting design's §9.1:
 * escrowed issued-currency amounts are invisible to `gateway_balances`
 * obligations, so any published supply figure must add them back. Scans
 * the *issuer's* `account_objects` for `Escrow` entries denominated in
 * `currency`/`issuerAddress` — escrows link into the issuer's owner
 * directory regardless of who created them, and cost the issuer no
 * reserve, so this works even though the issuer's own `OwnerCount` stays 0.
 */
export async function sumEscrowedAmount(
  client: Client,
  issuerAddress: string,
  currency: string,
): Promise<{ total: string; count: number }> {
  let total = 0n;
  let count = 0;
  let marker: unknown;
  const SCALE = 1_000_000; // six implied decimals; see note below.
  do {
    const response = await client.request({
      command: "account_objects",
      account: issuerAddress,
      ledger_index: "validated",
      type: "escrow",
      limit: 400,
      ...(marker !== undefined ? { marker } : {}),
    });
    for (const object of response.result.account_objects) {
      if (object.LedgerEntryType !== "Escrow") continue;
      const entry = object as Escrow;
      const amount = entry.Amount;
      if (!isIouAmount(amount)) continue;
      if (amount.issuer !== issuerAddress || amount.currency !== currency) continue;
      total += decimalToScaledBigInt(amount.value, SCALE);
      count += 1;
    }
    marker = response.result.marker;
  } while (marker !== undefined);
  return { total: scaledBigIntToDecimal(total, SCALE), count };
}

/**
 * xrpl.js types the raw `Escrow` ledger entry's `Amount` as a plain
 * `string`, but rippled actually returns an IOU/MPT amount as an object
 * when the escrow holds one (only XRP escrows are a bare drops string) —
 * so this reads the live value as `unknown` rather than trusting that type.
 */
function isIouAmount(amount: unknown): amount is IssuedAmount {
  return (
    typeof amount === "object" &&
    amount !== null &&
    "currency" in amount &&
    "issuer" in amount &&
    "value" in amount
  );
}

/**
 * Minimal decimal <-> scaled-integer helpers so summing escrowed amounts
 * does not touch floating point. $PND-style tranches are whole numbers in
 * practice, but this tolerates the fractional deliveries a nonzero
 * `TransferRate` produces (see the design's §9.3) without losing precision
 * within the chosen scale.
 */
function decimalToScaledBigInt(value: string, scale: number): bigint {
  const parts = value.split(".");
  const whole = parts[0] || "0";
  const fraction = parts[1] ?? "";
  const paddedFraction = (fraction + "0".repeat(String(scale).length - 1)).slice(0, String(scale).length - 1);
  return BigInt(whole) * BigInt(scale) + BigInt(paddedFraction || "0");
}

function scaledBigIntToDecimal(value: bigint, scale: number): string {
  const digits = String(scale).length - 1;
  const whole = value / BigInt(scale);
  const fraction = (value % BigInt(scale)).toString().padStart(digits, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
}
