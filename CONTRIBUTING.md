# Contributing

Bug reports and focused pull requests are welcome.

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

For Android changes, also run:

```sh
./android/gradlew -p android :app:testDebugUnitTest :app:assembleDebug
```

Use `main` for stable work and `testing` for beta releases. Do not commit signing keys, passwords, generated bundles, or local settings.
