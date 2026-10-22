# Contributing

Thank you for looking. This is the free, self-hosted version of Ikat, and it is public, so every change arrives as a pull request
that Alan reviews and merges. Nobody pushes to `main`.

## Before you start

For anything bigger than a fix, open an issue first so we can agree on the direction. The sandbox covers the free features
(accounts, net worth, transactions, spending, budgets and recurring charges); investing, equity, tax, planning, cards and loans
belong to the iPhone app and are not added here.

## Make a change

1. Branch from `main`, named for the change: `feat/csv-columns`, `fix/budget-rollover`.
2. Run `npm install` with Node 24 (`.nvmrc`), then `PORT=4546 npm run dev`.
3. Before you push, run `npm test`, `npm run typecheck` and `npm run format:check`. All three pass.
4. Open a pull request. Say what changed and why, how you tested it, and what to look at first. A screen change comes with a
   screenshot.

## Pull requests and commits

- One pull request is one logical change, small enough to read in one sitting.
- One pull request is one commit. Fix review comments with `git commit --amend` and `git push --force-with-lease`; the pull
  request is squash-merged either way.
- The commit subject is a conventional message: `feat(spending): …`, `fix(import): …`, `docs: …`. No pull request number in it,
  and no trailers.
- Money is integer cents wherever it is stored or summed, and a transaction's sign is plus for money in, minus for money out.

## Never in a change

Real account numbers, balances, holdings, lenders, employers or dates; API keys, tokens or passwords; and `.env` files. Use
invented examples ("Harbor CU", "ACME.RSU"). This repository is public.

## License

By contributing you agree your work is licensed under [PolyForm Noncommercial 1.0.0](LICENSE.md).
