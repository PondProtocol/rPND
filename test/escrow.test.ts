import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEscrowCancel,
  buildEscrowCreate,
  buildEscrowFinish,
  buildVestingSchedule,
  DEFAULT_VESTING_SCHEDULE,
  monthlyTrancheDates,
  rippleTimeToIso,
  toRippleTime,
} from "../src/escrow.ts";

const issuer = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
const treasury = "rTreasuryAddressPlaceholderXXXXXXXX";
const other = "rOtherAddressPlaceholderXXXXXXXXXXX";

test("toRippleTime passes numbers through and converts ISO strings/Dates", () => {
  assert.equal(toRippleTime(852076800), 852076800);
  // 2027-01-01T00:00:00Z is Ripple time 852076800 (Unix 1798761600 minus the 946684800 epoch diff).
  assert.equal(toRippleTime("2027-01-01T00:00:00.000Z"), 852076800);
  assert.equal(toRippleTime(new Date("2027-01-01T00:00:00.000Z")), 852076800);
});

test("rippleTimeToIso round-trips toRippleTime", () => {
  assert.equal(rippleTimeToIso(852076800), "2027-01-01T00:00:00.000Z");
});

test("buildEscrowCreate requires at least one of finishAfter/cancelAfter", () => {
  assert.throws(
    () =>
      buildEscrowCreate({
        account: treasury,
        destination: treasury,
        amount: { currency: "PND", issuer, value: "1" },
      }),
    /finishAfter or cancelAfter/,
  );
});

test("buildEscrowCreate refuses to build an escrow where the sender is the currency's issuer", () => {
  assert.throws(
    () =>
      buildEscrowCreate({
        account: issuer,
        destination: treasury,
        amount: { currency: "PND", issuer, value: "9000000000" },
        finishAfter: "2027-01-01T00:00:00Z",
      }),
    /issuer can never escrow its own currency/,
  );
});

test("buildEscrowCreate builds a self-escrow with FinishAfter only, no CancelAfter, no Condition", () => {
  const tx = buildEscrowCreate({
    account: treasury,
    destination: treasury,
    amount: { currency: "PND", issuer, value: "9000000000" },
    finishAfter: "2027-01-01T00:00:00.000Z",
  });
  assert.equal(tx.TransactionType, "EscrowCreate");
  assert.equal(tx.Account, treasury);
  assert.equal(tx.Destination, treasury);
  assert.equal(tx.FinishAfter, 852076800);
  assert.equal(tx.CancelAfter, undefined);
  assert.equal(tx.Condition, undefined);
});

test("buildEscrowCreate accepts an explicit cancelAfter and a different destination", () => {
  const tx = buildEscrowCreate({
    account: treasury,
    destination: other,
    amount: { currency: "PND", issuer, value: "5" },
    finishAfter: 1000,
    cancelAfter: 2000,
  });
  assert.equal(tx.Destination, other);
  assert.equal(tx.FinishAfter, 1000);
  assert.equal(tx.CancelAfter, 2000);
});

test("buildEscrowFinish and buildEscrowCancel carry Owner + OfferSequence", () => {
  const finish = buildEscrowFinish({ account: other, owner: treasury, offerSequence: 42 });
  assert.equal(finish.TransactionType, "EscrowFinish");
  assert.equal(finish.Owner, treasury);
  assert.equal(finish.OfferSequence, 42);
  assert.equal(finish.Fulfillment, undefined);

  const cancel = buildEscrowCancel({ account: other, owner: treasury, offerSequence: 42 });
  assert.equal(cancel.TransactionType, "EscrowCancel");
  assert.equal(cancel.Owner, treasury);
  assert.equal(cancel.OfferSequence, 42);
});

test("buildEscrowFinish carries Condition/Fulfillment when supplied", () => {
  const finish = buildEscrowFinish({
    account: other,
    owner: treasury,
    offerSequence: 1,
    condition: "AABB",
    fulfillment: "CCDD",
  });
  assert.equal(finish.Condition, "AABB");
  assert.equal(finish.Fulfillment, "CCDD");
});

test("monthlyTrancheDates computes count monthly-spaced ISO dates, month-end safe", () => {
  const dates = monthlyTrancheDates({ count: 3, startIso: "2027-01-01T00:00:00.000Z" });
  assert.deepEqual(dates, ["2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z", "2027-03-01T00:00:00.000Z"]);
});

test("monthlyTrancheDates honours a different interval and rejects a bad count", () => {
  const dates = monthlyTrancheDates({ count: 2, startIso: "2027-01-01T00:00:00.000Z", intervalMonths: 3 });
  assert.deepEqual(dates, ["2027-01-01T00:00:00.000Z", "2027-04-01T00:00:00.000Z"]);
  assert.throws(() => monthlyTrancheDates({ count: 0, startIso: "2027-01-01T00:00:00.000Z" }), /count/);
});

test("buildVestingSchedule defaults match the recommended design: 10x9B PND, monthly from 2027-01-01, self-escrow, FinishAfter only", () => {
  const txs = buildVestingSchedule({ treasuryAddress: treasury, issuerAddress: issuer });
  assert.equal(txs.length, DEFAULT_VESTING_SCHEDULE.count);
  for (const tx of txs) {
    assert.equal(tx.Account, treasury);
    assert.equal(tx.Destination, treasury);
    assert.equal(tx.CancelAfter, undefined);
    assert.equal(tx.Condition, undefined);
    const amount = tx.Amount as { currency: string; issuer: string; value: string };
    assert.equal(amount.currency, "PND");
    assert.equal(amount.issuer, issuer);
    assert.equal(amount.value, DEFAULT_VESTING_SCHEDULE.trancheValue);
  }
  assert.equal(txs[0]?.FinishAfter, toRippleTimeForTest("2027-01-01T00:00:00.000Z"));
  assert.equal(txs[9]?.FinishAfter, toRippleTimeForTest("2027-10-01T00:00:00.000Z"));
});

test("buildVestingSchedule overrides every default: count, value, currency, start date, interval, destination", () => {
  const txs = buildVestingSchedule({
    treasuryAddress: treasury,
    issuerAddress: issuer,
    currency: "XYZ",
    destination: other,
    count: 2,
    trancheValue: "100",
    startIso: "2028-06-01T00:00:00.000Z",
    intervalMonths: 6,
  });
  assert.equal(txs.length, 2);
  assert.equal(txs[0]?.Destination, other);
  const firstAmount = txs[0]?.Amount as { currency: string; value: string };
  assert.equal(firstAmount.currency, "XYZ");
  assert.equal(firstAmount.value, "100");
  assert.equal(txs[1]?.FinishAfter, toRippleTimeForTest("2028-12-01T00:00:00.000Z"));
});

test("buildVestingSchedule's single-tranche form is exactly what a later top-up escrow looks like", () => {
  const [topUp] = buildVestingSchedule({
    treasuryAddress: treasury,
    issuerAddress: issuer,
    count: 1,
    trancheValue: "1234",
    startIso: "2028-01-01T00:00:00.000Z",
  });
  assert.ok(topUp);
  const built = buildEscrowCreate({
    account: treasury,
    destination: treasury,
    amount: { currency: "PND", issuer, value: "1234" },
    finishAfter: "2028-01-01T00:00:00.000Z",
  });
  assert.deepEqual(topUp, built);
});

function toRippleTimeForTest(iso: string): number {
  return toRippleTime(iso);
}
