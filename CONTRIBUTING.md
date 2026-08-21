# Contributing

Bug reports and focused pull requests are welcome.

## Target branch

Open every pull request against `testing`, the beta branch. Do not target `main` directly. The `main` branch is reserved for stable releases and only receives changes promoted from `testing` by the maintainers.

Before opening a pull request:

1. Keep platform-specific display code inside `src-tauri/src/display`.
2. Add a test for schedule, preview, or release-channel changes.
3. Run the checks below.

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Do not commit signing keys, passwords, generated bundles, or local settings.
