# Dependency and updater review — 2026-11-06

Reviewed the application source, native commands, dependency lockfiles, updater feed/signature configuration, capabilities, and CI/release workflows. No evidence of malicious application code or locally modified npm package contents was found. This is not proof that an upstream publisher or this computer has never been compromised.

## Findings and fixes

- Updated Vite and Vitest, removing known development-server, mock registration, worker, and esbuild vulnerabilities. Enforced patched `source-map-js` through a transitive override.
- Updated the native updater to 2.14.1 and its required Tauri dependencies, replacing vulnerable ZIP extraction code with zip 9.4.1. This requires Rust 1.90 or newer.
- Updated rustls, rustls-webpki, webpki-root-certs, and Tokio; removed a yanked async-executor version.
- Enabled a restrictive Content Security Policy. Production JavaScript loads from the application, and frontend network connections are limited to Tauri IPC. Development additionally permits the local Vite server. Inline styles remain enabled for React's dynamic styles.
- Kept update signatures, HTTPS feeds, and same-channel/newer-version checks enabled. Private updater keys and password files are ignored by Git; their paths were not found in the repository's current reachable history. Their contents were not read.
- CI now runs the actual Vitest suite and audits npm dependencies. CI/release installs disable lifecycle scripts, and native release builds use the committed Cargo lockfile.
- Automatic update checks remain silent while checking, when current, and on network errors. A real update opens the install dialog. Explicit manual checks retain their result/error feedback. Concurrent checks and duplicate installations are blocked.

## Verification

- All 169 npm lock entries matched their version's integrity hash at registry.npmjs.org.
- Compared 6,425 shipped files from 108 installed npm packages byte-for-byte against verified registry tarballs; no differences found. Optional packages for other platforms were checked by registry integrity metadata only.
- `bun audit`: no known vulnerabilities.
- `cargo audit --file src-tauri/Cargo.lock`: no reported vulnerabilities. Five informational warnings remain in Linux-only transitive dependencies (`proc-macro-error`, `glib`, `zbus_names`, `zvariant`, `zvariant_derive`). Dependency-tree checks confirmed these do not enter the Windows/macOS targets supported by this application. Linux is not validated by this review.
- `bun run test`: 21 tests passed, including eight updater regression tests.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: 10 tests passed on Windows.
- `bun run build` and `bun run tauri build --debug --no-bundle -- --locked`: passed on Windows.

Registry comparisons detect local tampering and lockfile inconsistencies; they cannot rule out malware already present in an official upstream release. Advisory results reflect the databases available at review time. macOS validation is delegated to the repository's CI.
