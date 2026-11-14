# Golden fixtures source

Copied verbatim (byte for byte, do not edit) from repo research-python, branch p1/dep-0A-0D-B6,
commit b1725efafa124a9b7fd0989c396dcc6f43588d4c, path `tests/fixtures/momentum_golden/`.
Format: `momentum_golden.v1` (`docs/contracts/momentum_golden.md` in that repo).

Refresh: in research-python run `uv run python scripts/momentum/make_golden.py`, then copy
`tests/fixtures/momentum_golden/*` over this directory and update the commit above. The parity
test (`breakoutMomentumParity.test.ts`) also fails if `manifest.format_version` changes.
