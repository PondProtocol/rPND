#!/usr/bin/env node
import { Wallet, decodeMPTokenMetadata } from "xrpl";
import { loadTokenConfig } from "./config.ts";
import {
  buildIssuerAccountSet,
  buildPndPayment,
  buildPndTrustSet,
  buildRpndAuthorize,
  buildRpndIssuanceCreate,
  buildRpndPayment,
  extractMptIssuanceId,
} from "./issuance.ts";
import { encodeRpndMetadata, renderXrpLedgerToml, rpndMetadata } from "./metadata.ts";
import { loadState, mergeState } from "./state.ts";
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
  issue-pnd            Trust line from operational + Payment of $PND from issuer
  issue-rpnd           MPTokenIssuanceCreate for $rPND; optionally mint to operational
  authorize-rpnd       Holder MPTokenAuthorize for $rPND
  send-pnd             Payment of $PND
  send-rpnd            Payment of $rPND
  status               Print addresses, $PND lines, and $rPND issuance id
  encode-metadata      Print XLS-89 JSON and hex for $rPND
  render-toml          Print xrp-ledger.toml for the issuer
  dry-run              Print unsigned transactions without submitting

Env: XRPL_NETWORK, XRPL_WSS, ISSUER_SEED, OPERATIONAL_SEED, HOLDER_SEED, ISSUER_DOMAIN
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
    const issuer = issuerWallet();
    const domain = arg("domain") ?? process.env.ISSUER_DOMAIN;
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

async function issuePnd(): Promise<void> {
  await withRuntime(async ({ client, config, network }) => {
    const issuer = issuerWallet();
    const operational = operationalWallet();
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
    const issuer = issuerWallet();
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
      const operational = operationalWallet();
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
    const holder = holderWallet();
    const issuanceId = requireIssuanceId(network);
    const tx = buildRpndAuthorize({ holderAddress: holder.address, issuanceId });
    const { hash } = await submitTx(client, tx, holder, "authorize-rpnd");
    process.stdout.write(`${JSON.stringify({ hash, holder: holder.address, issuanceId }, null, 2)}\n`);
  });
}

async function sendPnd(): Promise<void> {
  await withRuntime(async ({ client, config }) => {
    const from = senderWallet();
    const to = requireArg("to");
    const value = requireArg("value");
    const issuer = issuerWallet();
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
    const from = senderWallet();
    const to = requireArg("to");
    const value = requireArg("value");
    const issuanceId = requireIssuanceId(network);
    const tx = buildRpndPayment({ from: from.address, to, issuanceId, value });
    const { hash } = await submitTx(client, tx, from, "send-rpnd");
    process.stdout.write(`${JSON.stringify({ hash, from: from.address, to, value, issuanceId }, null, 2)}\n`);
  });
}

async function status(): Promise<void> {
  await withRuntime(async ({ client, config, network }) => {
    const issuer = optionalWallet(process.env.ISSUER_SEED ?? arg("issuer-seed"));
    const operational = optionalWallet(process.env.OPERATIONAL_SEED ?? arg("operational-seed"));
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

function issuerWallet(): Wallet {
  return walletFromSeed(arg("issuer-seed") ?? process.env.ISSUER_SEED, "issuer");
}

function operationalWallet(): Wallet {
  return walletFromSeed(arg("operational-seed") ?? process.env.OPERATIONAL_SEED, "operational");
}

function holderWallet(): Wallet {
  return walletFromSeed(arg("holder-seed") ?? process.env.HOLDER_SEED ?? process.env.OPERATIONAL_SEED, "holder");
}

function senderWallet(): Wallet {
  return walletFromSeed(
    arg("from-seed") ?? process.env.OPERATIONAL_SEED ?? process.env.ISSUER_SEED,
    "from",
  );
}

function requireIssuanceId(network: NetworkName): string {
  return arg("rpnd-issuance-id") ?? loadState(network).rpndIssuanceId ?? requireArg("rpnd-issuance-id");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
