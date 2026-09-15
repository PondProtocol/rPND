# Contributing

This repo issues Pond Protocol's on-ledger assets. Most files here are ordinary TypeScript, but `config/tokens.json` is the token itself — treat changes to it differently from changes to code.

It is also the operator source of truth for the organization: other Pond Protocol repos document these tokens by reference and defer to the config here. A parameter change may require a follow-up in `pnd` or `protocol`; note that in the PR.

## Setup

Node 22+.

```bash
npm install
cp .env.example .env
```

No keys are needed for tests, `dry-run`, `encode-metadata`, or `render-toml`.

## Checks

Both must pass before review. CI runs the same two commands.

```bash
npm run typecheck
npm test
```

The live Devnet test is opt-in, hits the faucet, and is skipped by default:

```bash
npm run test:live
```

## Secrets

- Never commit a seed, a `.env`, or anything from `var/`. Faucet output in `var/` contains plaintext seeds.
- Devnet and Testnet keys are disposable. Never reuse them on mainnet.
- Mainnet keys do not belong in this repo, in CI, or in an issue or PR body — not even expired ones.
- Paste ledger addresses and transaction hashes freely; they are public.

## Changing the token

Any edit to `config/tokens.json` changes $PND or $rPND. In the PR, state:

1. Which field changed, and its old and new value.
2. Whether the field is still changeable on ledger after issuance. `AssetScale` and `MaximumAmount` never are. See [`docs/rpnd-spec.md`](docs/rpnd-spec.md#on-ledger-parameters).
3. The `dry-run` output for the affected transaction.

```bash
npx tsx src/cli.ts dry-run
npx tsx src/cli.ts encode-metadata   # if metadata fields changed; watch the byte count
```

Metadata must stay under 1024 bytes encoded. The encoder throws if it does not, so a failing `npm test` is the expected signal.

Keep `config/tokens.json` in sync with the ledger. If an `MPTokenIssuanceSet` changes metadata on ledger, the config change belongs in the same PR.

## Docs

`docs/rpnd-spec.md` is the normative spec for $rPND. If a change alters flags, metadata, amounts, or lifecycle, update it in the same PR — a spec that disagrees with `config/tokens.json` is worse than no spec.

Do not invent facts in docs. Issuance IDs, addresses, supply figures, domains, launch timing, and audit status are unknown until an owner supplies them. Write `TODO (owner):` and say what is missing, rather than filling a gap with a plausible value.

## Style

- TypeScript, ES modules, explicit `.ts` extensions on relative imports.
- `strict` is on and `npm run typecheck` must be clean. No `any`, no `@ts-ignore`.
- Transaction builders in `src/issuance.ts` are pure: config in, unsigned transaction out. Keep network calls in `src/runtime.ts` and `src/submit.ts` so builders stay testable offline.
- Read parameters from `config/tokens.json` via `loadTokenConfig()`. Do not hardcode a currency code, ticker, scale, or amount in `src/`.
- Prose in docs and comments: short declarative sentences, `$PND` and `$rPND` with the dollar sign, exact XRPL field and flag names in backticks.

## Commits and PRs

- One logical change per commit. Imperative subject line, e.g. `Freeze $rPND metadata with tifMPTMetadata`.
- Branch off `main` and open a PR; CI must be green.
- In the PR, say what was verified — `dry-run` output, a Devnet transaction hash, or the tests that cover it.

## Reporting problems

Bugs and questions: open an issue. Anything with security impact goes through [SECURITY.md](SECURITY.md) instead, not a public issue.
