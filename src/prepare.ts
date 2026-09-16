import type { Client, SubmittableTransaction } from "xrpl";

/**
 * Fill `Account`-relative fields (`Sequence`, `Fee`, `LastLedgerSequence`,
 * `NetworkID`) from live network state, exactly as the offline-signing
 * workflow needs: `client.autofill` needs only `tx.Account` and a
 * connected client, never a wallet or a seed. The result is a complete,
 * still-unsigned transaction ready to hand to an offline signer.
 */
export async function prepareUnsigned<T extends SubmittableTransaction>(client: Client, tx: T): Promise<T> {
  return client.autofill(tx);
}

/**
 * Prepare several transactions from the *same* signing account as one
 * consecutively-numbered offline batch. Autofills the first transaction
 * normally (querying live Sequence/Fee/LastLedgerSequence), then reuses
 * that Fee and LastLedgerSequence for the rest while incrementing Sequence
 * by one each time — the ordering the launch runbook's offline-signing
 * workflow requires ("numbered consecutively ... and submitted in that
 * order"). Never touches a wallet or a seed.
 */
export async function prepareSequencedBatch<T extends SubmittableTransaction & { Account: string }>(
  client: Client,
  transactions: readonly T[],
): Promise<T[]> {
  const first = transactions[0];
  if (first === undefined) return [];
  const rest = transactions.slice(1);
  const account = first.Account;
  for (const tx of rest) {
    if (tx.Account !== account) {
      throw new Error(
        `prepareSequencedBatch requires every transaction to share the same Account; got ${account} and ${tx.Account}.`,
      );
    }
  }

  const filledFirst: T = await client.autofill(first);
  if (filledFirst.Sequence === undefined) {
    throw new Error("autofill did not assign a Sequence; cannot prepare a consecutive batch.");
  }
  const sequence = filledFirst.Sequence;
  const fee = filledFirst.Fee;
  const lastLedgerSequence = filledFirst.LastLedgerSequence;

  const filledRest: T[] = rest.map((tx, index) => ({
    ...tx,
    Sequence: sequence + index + 1,
    ...(fee !== undefined ? { Fee: fee } : {}),
    ...(lastLedgerSequence !== undefined ? { LastLedgerSequence: lastLedgerSequence } : {}),
  }));

  return [filledFirst, ...filledRest];
}
