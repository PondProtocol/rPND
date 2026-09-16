#!/usr/bin/env node
import { Wallet, decodeMPTokenMetadata, type Client } from "xrpl";
import { loadTokenConfig } from "./config.ts";
import {
  buildEscrowCancel,
  buildEscrowCreate,
  buildEscrowFinish,
  buildVestingSchedule,
  DEFAULT_VESTING_SCHEDULE,
  listEscrows,
  rippleTimeToIso,
  sumEscrowedAmount,
} from "./escrow.ts";
import {
  assertClawbackWindowOpen,
  assertEscrowPreconditions,
  assertFlagNotAlreadyContradicted,
  assertFlagsNotContradictory,
} from "./guards.ts";
import {
  buildIssuerAccountSet,
  buildIssuerConfigurationSequence,
  buildIssuerFlagAccountSet,
  buildPndPayment,
  buildPndTrustSet,
  buildRpndAuthorize,
  buildRpndIssuanceCreate,
  buildRpndPayment,
  extractMptIssuanceId,
  isIssuerFlagName,
  type IssuerFlagName,
  type IssuerFlagPlan,
} from "./issuance.ts";
import { encodeRpndMetadata, renderXrpLedgerToml, rpndMetadata } from "./metadata.ts";
import { prepareSequencedBatch, prepareUnsigned } from "./prepare.ts";
import { listRecordedEscrows, loadState, mergeState, recordEscrow, updateEscrowStatus } from "./state.ts";
import { arg, flag, requireArg, submitTx, writeSecretsFile } from "./submit.ts";
import { optionalWallet, walletFromSeed, withRuntime } from "./runtime.ts";
import type { NetworkName } from "./types.ts";

const HELP = `rPND XRPL issuance toolkit

Tokens:
  $PND   IOU (issued currency) with code PND
  $rPND  Multi-Purpose Token with ticker RPND

Commands:
  fund                 Create faucet-funded issuer + operational wallets (dev/test nets)
  configure-issuer     AccountSet on the cold issuer (DefaultRipple, tick size, domain)
  issuer-flag          Standalone AccountSet for one asf flag (clawback, no-freeze, require-auth, allow-trust-line-locking, default-ripple)
  issuer-flag-sequence Build the ordered AccountSet batch for a chosen flag configuration
  issue-pnd            Trust line from operational + Payment of $PND from issuer
  issue-rpnd           MPTokenIssuanceCreate for $rPND; optionally mint to operational
  authorize-rpnd       Holder MPTokenAuthorize for $rPND
  send-pnd             Payment of $PND
  send-rpnd            Payment of $rPND
  escrow-create        EscrowCreate for an issued currency (defaults to self-escrow)
  escrow-finish        EscrowFinish by Owner + OfferSequence (permissionless once due)
  escrow-cancel        EscrowCancel by Owner + OfferSequence (only if CancelAfter was set)
  escrow-schedule      Build/submit the dated-tranche vesting schedule (10x by default) from a treasury
  escrow-status        List live escrows for an account; supply = obligations + escrowed
  status               Print addresses, $PND lines, and $rPND issuance id
  encode-metadata      Print XLS-89 JSON and hex for $rPND
  render-toml          Print xrp-ledger.toml for the issuer
  dry-run              Print unsigned transactions without submitting

Pass --prepare on any signing command to skip signing entirely: it connects,
autofills Account/Sequence/Fee/LastLedgerSequence from live network state,
and prints the still-unsigned transaction for an offline signer. No seed is
read in that mode, and none ever will be for mainnet — this toolkit refuses
to build a mainnet wallet from a seed at all.

Env: XRPL_NETWORK, XRPL_WSS, ISSUER_SEED, OPERATIONAL_SEED, HOLDER_SEED, TREASURY_SEED, ISSUER_DOMAIN
`;

async function main(): Promise<void> {
  const command = process.argv[2] ?? "help";
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return;
    case "encode-metadata":
      encodeMetadata();
      return;
    case "render-toml":
      renderToml();
      return;
    case "dry-run":
      dryRun();
      return;
    case "fund":
      await fund();
      return;
    case "configure-issuer":
      await configureIssuer();
      return;
    case "issuer-flag":
      await issuerFlag();
      return;
    case "issuer-flag-sequence":
      await issuerFlagSequence();
      return;
    case "issue-pnd":
      await issuePnd();
      return;
    case "issue-rpnd":
      await issueRpnd();
      return;
    case "authorize-rpnd":
      await authorizeRpnd();
      return;
    case "send-pnd":
      await sendPnd();
      return;
    case "send-rpnd":
      await sendRpnd();
      return;
    case "escrow-create":
      await escrowCreate();
      return;
    case "escrow-finish":
      await escrowFinish();
      return;
    case "escrow-cancel":
      await escrowCancel();
      return;
    case "escrow-schedule":
      await escrowSchedule();
      return;
    case "escrow-status":
      await escrowStatus();
      return;
    case "status":
      await status();
      return;
    default:
      throw new Error(`Unknown command "${command}". Run without args for help.`);
  }
}

function encodeMetadata(): void {
  const config = loadTokenConfig();
  const json = rpndMetadata(config);
  const hex = encodeRpndMetadata(config);
  process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  process.stdout.write(`hex=${hex}\n`);
  process.stdout.write(`bytes=${hex.length / 2}\n`);
}

function renderToml(): void {
  const issuer = arg("issuer") ?? process.env.ISSUER_ADDRESS ?? "";
  if (!issuer) throw new Error("Pass --issuer <classicAddress>");
  const domain = arg("domain") ?? process.env.ISSUER_DOMAIN ?? "example.com";
  const network = arg("network") ?? process.env.XRPL_NETWORK ?? "devnet";
  const issuanceId = arg("rpnd-issuance-id") ?? loadState(network as NetworkName).rpndIssuanceId;
  process.stdout.write(
    renderXrpLedgerToml({
      issuerAddress: issuer,
      issuerDomain: domain,
      network,
      ...(issuanceId ? { rpndIssuanceId: issuanceId } : {}),
    }),
  );
}

function dryRun(): void {
  const config = loadTokenConfig();
  const issuer = arg("issuer") ?? "rISSUER_ADDRESS_PLACEHOLDER";
  const operational = arg("operational") ?? "rOPERATIONAL_ADDRESS_PLACEHOLDER";
  const issuanceId = arg("rpnd-issuance-id") ?? "0".repeat(48);
  const domain = arg("domain") ?? process.env.ISSUER_DOMAIN;

  const txs = {
    configureIssuer: buildIssuerAccountSet({
      issuerAddress: issuer,
      config,
      ...(domain ? { domain } : {}),
    }),
    pndTrustSet: buildPndTrustSet({
      holderAddress: operational,
      issuerAddress: issuer,
      config,
    }),
    pndPayment: buildPndPayment({
      from: issuer,
      to: operational,
      issuerAddress: issuer,
      value: config.pnd.initialIssuance,
      config,
    }),
    rpndCreate: buildRpndIssuanceCreate({ issuerAddress: issuer, config }),
    rpndAuthorize: buildRpndAuthorize({
      holderAddress: operational,
      issuanceId,
    }),
    rpndPayment: buildRpndPayment({
      from: issuer,
      to: operational,
      issuanceId,
      value: config.rpnd.initialIssuance,
    }),
  };
  process.stdout.write(`${JSON.stringify(txs, null, 2)}\n`);
}

async function fund(): Promise<void> {
  await withRuntime(async ({ client, network }) => {
    if (network === "mainnet") {
      throw new Error("Refusing to faucet-fund on mainnet.");
    }
    process.stderr.write(`Funding issuer and operational wallets on ${network}...\n`);
    const issuer = await client.fundWallet();
    const operational = await client.fundWallet();
    const secrets = {
      network,
      issuerAddress: issuer.wallet.address,
      issuerSeed: issuer.wallet.seed ?? "",
      operationalAddress: operational.wallet.address,
      operationalSeed: operational.wallet.seed ?? "",
    };
    const path = writeSecretsFile(network, secrets);
    mergeState(network, {
      issuerAddress: secrets.issuerAddress,
      operationalAddress: secrets.operationalAddress,
    });
    process.stdout.write(
      `${JSON.stringify({ ...secrets, savedTo: path, warning: "Treat seeds as secrets. Do not commit var/." }, null, 2)}\n`,
    );
  });
}

async function configureIssuer(): Promise<void> {
  await withRuntime(async ({ client, config, network }) => {
    const domain = arg("domain") ?? process.env.ISSUER_DOMAIN;

    if (flag("prepare")) {
      const issuerAddress = arg("issuer") ?? requireArg("issuer");
      const tx = buildIssuerAccountSet({ issuerAddress, config, ...(domain ? { domain } : {}) });
      const prepared = await prepareUnsigned(client, tx);
      process.stdout.write(`${JSON.stringify({ network, prepared }, null, 2)}\n`);
      return;
    }

    const issuer = issuerWallet(network);
    const tx = buildIssuerAccountSet({
      issuerAddress: issuer.address,
      config,
      ...(domain ? { domain } : {}),
    });
    const { hash } = await submitTx(client, tx, issuer, "configure-issuer");
    mergeState(network, { issuerAddress: issuer.address });
    process.stdout.write(`${JSON.stringify({ hash, issuer: issuer.address, domain: domain ?? null }, null, 2)}\n`);
  });
}

function parseIssuerFlagName(raw: string): IssuerFlagName {
  const camel = raw.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  if (!isIssuerFlagName(camel)) {
    throw new Error(
      `Unknown --flag "${raw}". Use one of: default-ripple, require-auth, no-freeze, ` +
        "allow-trust-line-clawback, allow-trust-line-locking.",
    );
  }
  return camel;
}

function parseFlagMode(): "set" | "clear" {
  const mode = arg("mode") ?? "set";
  if (mode !== "set" && mode !== "clear") {
    throw new Error(`Unknown --mode "${mode}". Use "set" or "clear".`);
  }
  return mode;
}

/**
 * A standalone AccountSet for exactly one asf flag. This is the tooling the
 * launch runbook found entirely missing: `buildIssuerAccountSet` could only
 * ever emit `asfDefaultRipple`, so every other launch-critical flag decision
 * — clawback, NoFreeze, RequireAuth, escrow's trust-line-locking prerequisite
 * — had no command behind it. The flag is a caller-chosen parameter; this
 * command does not prefer or default to any particular one.
 */
async function issuerFlag(): Promise<void> {
  await withRuntime(async ({ client, network }) => {
    const flagName = parseIssuerFlagName(requireArg("flag"));
    const mode = parseFlagMode();

    if (flag("prepare")) {
      const issuerAddress = requireArg("issuer");
      const tx = buildIssuerFlagAccountSet({ issuerAddress, flag: flagName, mode });
      const prepared = await prepareUnsigned(client, tx);
      process.stdout.write(`${JSON.stringify({ network, prepared }, null, 2)}\n`);
      return;
    }

    const issuer = issuerWallet(network);
    if (mode === "set") {
      await runLiveFlagGuards(client, issuer.address, flagName);
    }
    const tx = buildIssuerFlagAccountSet({ issuerAddress: issuer.address, flag: flagName, mode });
    const { hash } = await submitTx(client, tx, issuer, `issuer-flag ${flagName} ${mode}`);
    mergeState(network, { issuerAddress: issuer.address });
    process.stdout.write(`${JSON.stringify({ hash, issuer: issuer.address, flag: flagName, mode }, null, 2)}\n`);
  });
}

/**
 * Live guards, run immediately before signing — never before `--prepare`,
 * since preparing does not touch the ledger by design and the owner may be
 * preparing against a different account than they will ultimately sign for.
 */
async function runLiveFlagGuards(client: Client, issuerAddress: string, flagName: IssuerFlagName): Promise<void> {
  if (flagName === "allowTrustLineClawback") {
    await assertClawbackWindowOpen(client, issuerAddress);
    await assertFlagNotAlreadyContradicted(client, issuerAddress, "allowTrustLineClawback");
  }
  if (flagName === "noFreeze") {
    await assertFlagNotAlreadyContradicted(client, issuerAddress, "noFreeze");
  }
}

/**
 * Build the full ordered AccountSet batch for a chosen flag configuration —
 * "each flag needs its own transaction" from the runbook, made concrete.
 * `--prepare` fills Sequence/Fee/LastLedgerSequence for the whole batch as
 * one consecutively-numbered offline-signing set (no seed, ever); without
 * it, transactions are signed and submitted one at a time, confirming each
 * before the next, per the runbook's guidance for irreversible batches.
 */
async function issuerFlagSequence(): Promise<void> {
  await withRuntime(async ({ client, config, network }) => {
    const domain = arg("domain") ?? process.env.ISSUER_DOMAIN;
    const plan: IssuerFlagPlan = {
      clawback: flag("clawback"),
      requireAuth: flag("require-auth"),
      noFreeze: flag("no-freeze"),
      allowTrustLineLocking: flag("allow-trust-line-locking"),
    };
    assertFlagsNotContradictory(plan);

    if (flag("prepare")) {
      const issuerAddress = requireArg("issuer");
      const txs = buildIssuerConfigurationSequence({ issuerAddress, config, plan, ...(domain ? { domain } : {}) });
      const prepared = await prepareSequencedBatch(client, txs);
      process.stdout.write(`${JSON.stringify({ network, plan, prepared }, null, 2)}\n`);
      return;
    }

    const issuer = issuerWallet(network);
    if (plan.clawback) await assertClawbackWindowOpen(client, issuer.address);
    if (plan.clawback) await assertFlagNotAlreadyContradicted(client, issuer.address, "allowTrustLineClawback");
    if (plan.noFreeze) await assertFlagNotAlreadyContradicted(client, issuer.address, "noFreeze");

    const txs = buildIssuerConfigurationSequence({
      issuerAddress: issuer.address,
      config,
      plan,
      ...(domain ? { domain } : {}),
    });
    const hashes: string[] = [];
    for (const tx of txs) {
      const { hash } = await submitTx(client, tx, issuer, `issuer-flag-sequence ${JSON.stringify(tx)}`);
      hashes.push(hash);
    }
    mergeState(network, { issuerAddress: issuer.address });
    process.stdout.write(`${JSON.stringify({ issuer: issuer.address, plan, hashes }, null, 2)}\n`);
  });
}

async function issuePnd(): Promise<void> {
  await withRuntime(async ({ client, config, network }) => {
    const issuer = issuerWallet(network);
    const operational = operationalWallet(network);
    const value = arg("value") ?? config.pnd.initialIssuance;

    const trust = buildPndTrustSet({
      holderAddress: operational.address,
      issuerAddress: issuer.address,
      config,
    });
    const trustResult = await submitTx(client, trust, operational, "pnd TrustSet");

    const payment = buildPndPayment({
      from: issuer.address,
      to: operational.address,
      issuerAddress: issuer.address,
      value,
      config,
    });
    const payResult = await submitTx(client, payment, issuer, "pnd Payment");

    mergeState(network, {
      issuerAddress: issuer.address,
      operationalAddress: operational.address,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          trustHash: trustResult.hash,
          paymentHash: payResult.hash,
          currency: config.pnd.currency,
          value,
          issuer: issuer.address,
          operational: operational.address,
        },
        null,
        2,
      )}\n`,
    );
  });
}

async function issueRpnd(): Promise<void> {
  await withRuntime(async ({ client, config, network }) => {
    if (!config.networks[network].supportsMpt) {
      throw new Error(`${network} is not marked MPT-capable in config/tokens.json. Use Devnet for $rPND.`);
    }
    const issuer = issuerWallet(network);
    const create = buildRpndIssuanceCreate({ issuerAddress: issuer.address, config });
    const created = await submitTx(client, create, issuer, "rPND MPTokenIssuanceCreate");
    const issuanceId = extractMptIssuanceId(created.meta);
    if (!issuanceId) {
      throw new Error("MPTokenIssuanceCreate succeeded but mpt_issuance_id was not in metadata.");
    }

    const result: Record<string, unknown> = {
      createHash: created.hash,
      rpndIssuanceId: issuanceId,
      explorer: `${config.networks[network].explorerMpt}${issuanceId}`,
    };

    if (!flag("create-only")) {
      const operational = operationalWallet(network);
      const authorize = buildRpndAuthorize({
        holderAddress: operational.address,
        issuanceId,
      });
      const auth = await submitTx(client, authorize, operational, "rPND MPTokenAuthorize");
      result.authorizeHash = auth.hash;

      const mintValue = arg("value") ?? config.rpnd.initialIssuance;
      const payment = buildRpndPayment({
        from: issuer.address,
        to: operational.address,
        issuanceId,
        value: mintValue,
      });
      const minted = await submitTx(client, payment, issuer, "rPND initial Payment");
      result.mintHash = minted.hash;
      result.mintValue = mintValue;
      mergeState(network, {
        issuerAddress: issuer.address,
        operationalAddress: operational.address,
        rpndIssuanceId: issuanceId,
      });
    } else {
      mergeState(network, { issuerAddress: issuer.address, rpndIssuanceId: issuanceId });
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });
}

async function authorizeRpnd(): Promise<void> {
  await withRuntime(async ({ client, network }) => {
    const holder = holderWallet(network);
    const issuanceId = requireIssuanceId(network);
    const tx = buildRpndAuthorize({ holderAddress: holder.address, issuanceId });
    const { hash } = await submitTx(client, tx, holder, "authorize-rpnd");
    process.stdout.write(`${JSON.stringify({ hash, holder: holder.address, issuanceId }, null, 2)}\n`);
  });
}

async function sendPnd(): Promise<void> {
  await withRuntime(async ({ client, config, network }) => {
    const from = senderWallet(network);
    const to = requireArg("to");
    const value = requireArg("value");
    const issuer = issuerWallet(network);
    const tx = buildPndPayment({
      from: from.address,
      to,
      issuerAddress: issuer.address,
      value,
      config,
    });
    const { hash } = await submitTx(client, tx, from, "send-pnd");
    process.stdout.write(`${JSON.stringify({ hash, from: from.address, to, value, currency: "PND" }, null, 2)}\n`);
  });
}

async function sendRpnd(): Promise<void> {
  await withRuntime(async ({ client, network }) => {
    const from = senderWallet(network);
    const to = requireArg("to");
    const value = requireArg("value");
    const issuanceId = requireIssuanceId(network);
    const tx = buildRpndPayment({ from: from.address, to, issuanceId, value });
    const { hash } = await submitTx(client, tx, from, "send-rpnd");
    process.stdout.write(`${JSON.stringify({ hash, from: from.address, to, value, issuanceId }, null, 2)}\n`);
  });
}

function escrowAmountFromArgs(config: { pnd: { currency: string } }): { currency: string; issuer: string; value: string } {
  return {
    currency: arg("currency") ?? config.pnd.currency,
    issuer: requireArg("issuer"),
    value: requireArg("value"),
  };
}

/**
 * EscrowCreate for an issued currency. Defaults `--to` to the sending
 * account itself (self-escrow), which is the shape the vesting design
 * found makes permissionless release harmless — but it is a default, not
 * a constraint: pass `--to` to escrow to any other destination. This same
 * command is the vesting plan's "add a top-up later" mechanism: a top-up
 * is nothing but another EscrowCreate with a new date and amount.
 */
async function escrowCreate(): Promise<void> {
  await withRuntime(async ({ client, config, network }) => {
    const amount = escrowAmountFromArgs(config);
    const finishAfter = arg("finish-after");
    const cancelAfter = arg("cancel-after");

    if (flag("prepare")) {
      const account = requireArg("from");
      const destination = arg("to") ?? account;
      await assertEscrowPreconditions(client, amount.issuer);
      const tx = buildEscrowCreate({
        account,
        destination,
        amount,
        ...(finishAfter ? { finishAfter } : {}),
        ...(cancelAfter ? { cancelAfter } : {}),
      });
      const prepared = await prepareUnsigned(client, tx);
      process.stdout.write(`${JSON.stringify({ network, prepared }, null, 2)}\n`);
      return;
    }

    const from = treasuryWallet(network);
    const destination = arg("to") ?? from.address;
    await assertEscrowPreconditions(client, amount.issuer);
    const tx = buildEscrowCreate({
      account: from.address,
      destination,
      amount,
      ...(finishAfter ? { finishAfter } : {}),
      ...(cancelAfter ? { cancelAfter } : {}),
    });
    const { hash, submitted } = await submitTx(client, tx, from, "escrow-create");
    const sequence = submitted.Sequence;
    if (sequence !== undefined) {
      recordEscrow(network, {
        owner: from.address,
        offerSequence: sequence,
        destination,
        currency: amount.currency,
        issuer: amount.issuer,
        value: amount.value,
        ...(tx.FinishAfter !== undefined ? { finishAfter: rippleTimeToIso(tx.FinishAfter) } : {}),
        ...(tx.CancelAfter !== undefined ? { cancelAfter: rippleTimeToIso(tx.CancelAfter) } : {}),
        createTxHash: hash,
        status: "open",
      });
    }
    process.stdout.write(
      `${JSON.stringify({ hash, account: from.address, destination, amount, sequence }, null, 2)}\n`,
    );
  });
}

async function escrowFinish(): Promise<void> {
  await withRuntime(async ({ client, network }) => {
    const owner = requireArg("owner");
    const offerSequence = Number(requireArg("offer-sequence"));
    const condition = arg("condition");
    const fulfillment = arg("fulfillment");

    if (flag("prepare")) {
      const account = requireArg("from");
      const tx = buildEscrowFinish({
        account,
        owner,
        offerSequence,
        ...(condition ? { condition } : {}),
        ...(fulfillment ? { fulfillment } : {}),
      });
      const prepared = await prepareUnsigned(client, tx);
      process.stdout.write(`${JSON.stringify({ network, prepared }, null, 2)}\n`);
      return;
    }

    const from = anyFundedWallet(network);
    const tx = buildEscrowFinish({
      account: from.address,
      owner,
      offerSequence,
      ...(condition ? { condition } : {}),
      ...(fulfillment ? { fulfillment } : {}),
    });
    const { hash } = await submitTx(client, tx, from, "escrow-finish");
    updateEscrowStatusIfKnown(network, owner, offerSequence, "finished");
    process.stdout.write(`${JSON.stringify({ hash, account: from.address, owner, offerSequence }, null, 2)}\n`);
  });
}

async function escrowCancel(): Promise<void> {
  await withRuntime(async ({ client, network }) => {
    const owner = requireArg("owner");
    const offerSequence = Number(requireArg("offer-sequence"));

    if (flag("prepare")) {
      const account = requireArg("from");
      const tx = buildEscrowCancel({ account, owner, offerSequence });
      const prepared = await prepareUnsigned(client, tx);
      process.stdout.write(`${JSON.stringify({ network, prepared }, null, 2)}\n`);
      return;
    }

    const from = anyFundedWallet(network);
    const tx = buildEscrowCancel({ account: from.address, owner, offerSequence });
    const { hash } = await submitTx(client, tx, from, "escrow-cancel");
    updateEscrowStatusIfKnown(network, owner, offerSequence, "cancelled");
    process.stdout.write(`${JSON.stringify({ hash, account: from.address, owner, offerSequence }, null, 2)}\n`);
  });
}

/**
 * The ten-tranche (by default) dated vesting schedule from a treasury to
 * itself. `--prepare` produces one consecutively-numbered offline-signing
 * batch, matching the runbook's guidance for the ten `EscrowCreate`
 * transactions. Signing and submitting live instead is done one at a time,
 * recording each `Sequence` as it succeeds — never pre-computing the whole
 * batch and walking away — because a failed create shifts every later
 * sequence number.
 */
async function escrowSchedule(): Promise<void> {
  await withRuntime(async ({ client, network }) => {
    const issuerAddress = requireArg("issuer");
    const currency = arg("currency") ?? DEFAULT_VESTING_SCHEDULE.currency;
    const count = arg("count") ? Number(arg("count")) : undefined;
    const trancheValue = arg("tranche-value");
    const startIso = arg("start");
    const intervalMonths = arg("interval-months") ? Number(arg("interval-months")) : undefined;
    const destination = arg("to");

    if (flag("prepare")) {
      const treasuryAddress = requireArg("treasury");
      await assertEscrowPreconditions(client, issuerAddress);
      const txs = buildVestingSchedule({
        treasuryAddress,
        issuerAddress,
        currency,
        ...(destination ? { destination } : {}),
        ...(count !== undefined ? { count } : {}),
        ...(trancheValue ? { trancheValue } : {}),
        ...(startIso ? { startIso } : {}),
        ...(intervalMonths !== undefined ? { intervalMonths } : {}),
      });
      const prepared = await prepareSequencedBatch(client, txs);
      process.stdout.write(`${JSON.stringify({ network, count: txs.length, prepared }, null, 2)}\n`);
      return;
    }

    const treasury = treasuryWallet(network);
    await assertEscrowPreconditions(client, issuerAddress);
    const txs = buildVestingSchedule({
      treasuryAddress: treasury.address,
      issuerAddress,
      currency,
      ...(destination ? { destination } : {}),
      ...(count !== undefined ? { count } : {}),
      ...(trancheValue ? { trancheValue } : {}),
      ...(startIso ? { startIso } : {}),
      ...(intervalMonths !== undefined ? { intervalMonths } : {}),
    });

    const results: Array<{ hash: string; sequence: number | undefined; finishAfter?: number }> = [];
    for (const tx of txs) {
      const { hash, submitted } = await submitTx(client, tx, treasury, "escrow-schedule EscrowCreate");
      const sequence = submitted.Sequence;
      results.push({ hash, sequence, ...(tx.FinishAfter !== undefined ? { finishAfter: tx.FinishAfter } : {}) });
      if (sequence !== undefined && typeof tx.Amount === "object" && "currency" in tx.Amount) {
        recordEscrow(network, {
          owner: treasury.address,
          offerSequence: sequence,
          destination: tx.Destination as string,
          currency: tx.Amount.currency,
          issuer: tx.Amount.issuer,
          value: tx.Amount.value,
          ...(tx.FinishAfter !== undefined ? { finishAfter: rippleTimeToIso(tx.FinishAfter) } : {}),
          ...(tx.CancelAfter !== undefined ? { cancelAfter: rippleTimeToIso(tx.CancelAfter) } : {}),
          createTxHash: hash,
          status: "open",
        });
      }
    }
    mergeState(network, { issuerAddress });
    process.stdout.write(`${JSON.stringify({ treasury: treasury.address, issuer: issuerAddress, results }, null, 2)}\n`);
  });
}

/**
 * Live escrows for an account, plus (with `--issuer`) the corrected supply
 * figure: `gateway_balances` obligations alone under-reports by the
 * escrowed amount, so this adds the sum of `Escrow` entries in the
 * issuer's own owner directory back in.
 */
async function escrowStatus(): Promise<void> {
  await withRuntime(async ({ client, network }) => {
    const owner = requireArg("owner");
    const live = await listEscrows(client, owner);
    const recorded = listRecordedEscrows(network, owner);
    const result: Record<string, unknown> = { owner, live, recorded };

    const issuerAddress = arg("issuer");
    const currency = arg("currency") ?? DEFAULT_VESTING_SCHEDULE.currency;
    if (issuerAddress) {
      const [balances, escrowed] = await Promise.all([
        client.request({ command: "gateway_balances", account: issuerAddress, ledger_index: "validated" }),
        sumEscrowedAmount(client, issuerAddress, currency),
      ]);
      const obligations = balances.result.obligations?.[currency] ?? "0";
      result.supply = {
        currency,
        obligations,
        escrowed: escrowed.total,
        escrowedEntryCount: escrowed.count,
        note: "true issued supply = gateway_balances obligations + sum of escrowed amounts from the issuer's account_objects",
      };
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });
}

function updateEscrowStatusIfKnown(
  network: NetworkName,
  owner: string,
  offerSequence: number,
  status: "finished" | "cancelled",
): void {
  const recorded = listRecordedEscrows(network, owner).find((entry) => entry.offerSequence === offerSequence);
  if (recorded) {
    updateEscrowStatus(network, owner, offerSequence, status);
  }
}

async function status(): Promise<void> {
  await withRuntime(async ({ client, config, network }) => {
    const issuer = optionalWallet(process.env.ISSUER_SEED ?? arg("issuer-seed"), network);
    const operational = optionalWallet(process.env.OPERATIONAL_SEED ?? arg("operational-seed"), network);
    const state = loadState(network);
    const issuerAddress = issuer?.address ?? state.issuerAddress;
    const operationalAddress = operational?.address ?? state.operationalAddress;
    if (!issuerAddress) {
      throw new Error("No issuer address. Run fund or set ISSUER_SEED.");
    }

    const lines = await client.request({
      command: "account_lines",
      account: operationalAddress ?? issuerAddress,
      ledger_index: "validated",
    });
    const pndLines = lines.result.lines.filter(
      (line) => line.currency === config.pnd.currency && line.account === issuerAddress,
    );

    let rpndIssuance: unknown = state.rpndIssuanceId ?? null;
    if (state.rpndIssuanceId) {
      const entry = await client.request({
        command: "ledger_entry",
        mpt_issuance: state.rpndIssuanceId,
        ledger_index: "validated",
      });
      const node = entry.result.node as { MPTokenMetadata?: string };
      rpndIssuance = {
        id: state.rpndIssuanceId,
        decodedMetadata: node.MPTokenMetadata ? decodeMPTokenMetadata(node.MPTokenMetadata) : null,
      };
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          network,
          issuer: issuerAddress,
          operational: operationalAddress ?? null,
          pndLines,
          rpnd: rpndIssuance,
        },
        null,
        2,
      )}\n`,
    );
  });
}

function issuerWallet(network: NetworkName): Wallet {
  return walletFromSeed(arg("issuer-seed") ?? process.env.ISSUER_SEED, "issuer", network);
}

function operationalWallet(network: NetworkName): Wallet {
  return walletFromSeed(arg("operational-seed") ?? process.env.OPERATIONAL_SEED, "operational", network);
}

function holderWallet(network: NetworkName): Wallet {
  return walletFromSeed(
    arg("holder-seed") ?? process.env.HOLDER_SEED ?? process.env.OPERATIONAL_SEED,
    "holder",
    network,
  );
}

function senderWallet(network: NetworkName): Wallet {
  return walletFromSeed(
    arg("from-seed") ?? process.env.OPERATIONAL_SEED ?? process.env.ISSUER_SEED,
    "from",
    network,
  );
}

/** Any funded account may submit EscrowFinish/EscrowCancel — releases are permissionless once due. */
function anyFundedWallet(network: NetworkName): Wallet {
  return walletFromSeed(
    arg("from-seed") ??
      process.env.TREASURY_SEED ??
      process.env.OPERATIONAL_SEED ??
      process.env.ISSUER_SEED,
    "from",
    network,
  );
}

function treasuryWallet(network: NetworkName): Wallet {
  return walletFromSeed(
    arg("treasury-seed") ?? process.env.TREASURY_SEED ?? process.env.OPERATIONAL_SEED,
    "treasury",
    network,
  );
}

function requireIssuanceId(network: NetworkName): string {
  return arg("rpnd-issuance-id") ?? loadState(network).rpndIssuanceId ?? requireArg("rpnd-issuance-id");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
