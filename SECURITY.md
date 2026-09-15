# Security

This repository builds and submits XRP Ledger transactions that issue assets. The sensitive material is not the code — it is the issuer keys and the token parameters.

## Reporting a vulnerability

TODO (owner): add a private reporting channel before this repo is public. Either enable GitHub private vulnerability reporting (Settings → Code security → Private vulnerability reporting) or publish a contact address here.

Until then, do not open a public issue for anything with security impact.

Please do not include seeds, private keys, or `.env` contents in a report. Addresses, `MPTokenIssuanceID`s, and transaction hashes are public and are safe to share.

## Scope

In scope:

- Transaction builders in `src/issuance.ts` producing a transaction that does not match `config/tokens.json` — wrong flags, wrong `ImmutableFlags`, wrong amounts or scale.
- Metadata encoding that misrepresents the token or bypasses the 1024-byte guard.
- Anything causing a seed to be logged, committed, or transmitted.
- Guards that fail to hold: faucet funding on mainnet, or an MPT create on a network where `supportsMpt` is false.

Out of scope:

- Vulnerabilities in the XRP Ledger protocol or in `rippled`. Report those to the [XRP Ledger project](https://xrpl.org/report-a-scam.html).
- Vulnerabilities in the `xrpl` library. Report those upstream.
- Devnet or Testnet keys being exposed. They are disposable by design.
- Token economics or governance decisions. Those are owner decisions, not vulnerabilities — see the open questions in the [README](README.md#open-questions).

## Key handling

- The **issuer (cold)** key signs `AccountSet`, $PND issuance, and `MPTokenIssuanceCreate`. In production it should stay offline and never enter this repo, `.env`, or CI.
- The **operational (hot)** key holds distributable inventory. Treat it as spendable and fund it accordingly.
- `var/` holds faucet output in plaintext and is gitignored. It is for Devnet and Testnet only.
- `npx tsx src/cli.ts fund` refuses to run on mainnet. Mainnet accounts are funded independently, outside this tooling.

## What this repo does not claim

No security review or audit of this code has been performed or commissioned. $rPND is not issued on mainnet from this repo, and there is no published `MPTokenIssuanceID`. Treat any token claiming to be $rPND as unverified until an owner publishes the issuance ID.
