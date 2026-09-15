# rPND

Issuance toolkit for two XRP Ledger tokens:

| Token | Ledger type | Identifier |
| --- | --- | --- |
| **$PND** | IOU (issued currency / trust line) | currency code `PND` |
| **$rPND** | Multi-Purpose Token (MPT) | ticker `RPND` plus `MPTokenIssuanceID` after create |

This repository is the operator source of truth for token config, XLS-26 / XLS-89 metadata, and scripts that configure an issuer, issue $PND, and create $rPND.

## Quick start

Node 22+.

```bash
npm install
cp .env.example .env
npm test
npm run typecheck
npx tsx src/cli.ts help
```

Print unsigned transactions (no network):

```bash
npx tsx src/cli.ts dry-run
npx tsx src/cli.ts encode-metadata
```

Devnet (faucet, MPT-capable) — never use these seeds on mainnet:

```bash
npx tsx src/cli.ts fund
# copy ISSUER_SEED and OPERATIONAL_SEED from the JSON into .env
npx tsx src/cli.ts configure-issuer
npx tsx src/cli.ts issue-pnd
npx tsx src/cli.ts issue-rpnd
npx tsx src/cli.ts status
```

`issue-rpnd` creates the MPT, has the operational account authorize it, and mints the configured initial amount. Pass `--create-only` to skip authorize + mint.

## Layout

- `config/tokens.json` — canonical $PND / $rPND parameters
- `config/xrp-ledger.toml.template` — XLS-26 file to host at `/.well-known/xrp-ledger.toml`
- `src/issuance.ts` — AccountSet, TrustSet, Payment, MPTokenIssuanceCreate, MPTokenAuthorize builders
- `src/cli.ts` — operator commands
- `docs/tokens.md` — token identity and metadata
- `docs/issuance.md` — issuance procedure and network notes

Local faucet output is written to `var/` (gitignored). Treat seeds as secrets.

## Networks

$rPND requires the MPTokens amendment. Default scripts at **Devnet**. Testnet is marked not MPT-capable in config until that network has the amendment. Mainnet issuance is a separate, reviewed operation — this repo does not faucet-fund mainnet accounts.

## License

Apache-2.0. See `LICENSE`.
