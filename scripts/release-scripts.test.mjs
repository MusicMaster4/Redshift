import { describe, expect, test } from "bun:test";

import {
  BETA_POINTER_TAG,
  endpointFor,
  parseArgs as parseApplyArgs,
  withCargoLockVersion,
  withCargoVersion,
  withTauriConfig,
} from "./apply-version.mjs";
import { parseArgs as parseVersionArgs } from "./release-version.mjs";
import {
  REQUIRED_PLATFORMS,
  buildManifest,
  platformsForAsset,
} from "./updater-manifest.mjs";

const REPO = "MusicMaster4/Redshift";

describe("release channels", () => {
  test("main and testing resolve to isolated feeds", () => {
    expect(endpointFor("stable", REPO)).toBe(
      `https://github.com/${REPO}/releases/latest/download/latest.json`,
    );
    expect(endpointFor("testing", REPO)).toBe(
      `https://github.com/${REPO}/releases/download/${BETA_POINTER_TAG}/latest.json`,
    );
    expect(endpointFor("stable", REPO)).not.toBe(endpointFor("testing", REPO));
  });

  test("only main and testing can publish", () => {
    expect(parseVersionArgs(["--branch", "main"]).channel).toBe("stable");
    expect(parseVersionArgs(["--branch", "testing"]).channel).toBe("testing");
    expect(() => parseVersionArgs(["--branch", "develop"])).toThrow();
  });

  test("a version cannot be stamped into the wrong channel", () => {
    expect(parseApplyArgs(["--version", "1.2.3"]).channel).toBe("stable");
    expect(parseApplyArgs(["--version", "1.2.3-testing.2"]).channel).toBe(
      "testing",
    );
    expect(() =>
      parseApplyArgs(["--version", "1.2.3", "--channel", "testing"]),
    ).toThrow();
  });
});

describe("version stamping", () => {
  test("preserves updater settings while replacing one endpoint", () => {
    const config = {
      version: "1.0.0",
      plugins: {
        updater: {
          pubkey: "KEY",
          endpoints: ["old"],
          windows: { installMode: "passive" },
        },
      },
    };
    const next = withTauriConfig(config, {
      version: "1.0.1-testing.1",
      channel: "testing",
      repo: REPO,
    });
    expect(next.plugins.updater.pubkey).toBe("KEY");
    expect(next.plugins.updater.endpoints).toEqual([
      endpointFor("testing", REPO),
    ]);
    expect(next.plugins.updater.windows.installMode).toBe("passive");
  });

  test("updates only Redshift's Cargo versions", () => {
    const toml =
      '[package]\nname = "redshift"\nversion = "1.0.0"\n\n[dependencies]\ntauri = "2"\n';
    expect(withCargoVersion(toml, "1.0.1")).toContain('version = "1.0.1"');
    const lock =
      '[[package]]\nname = "redshift"\nversion = "1.0.0"\n\n[[package]]\nname = "tauri"\nversion = "2.0.0"\n';
    const next = withCargoLockVersion(lock, "redshift", "1.0.1");
    expect(next).toContain('name = "redshift"\nversion = "1.0.1"');
    expect(next).toContain('name = "tauri"\nversion = "2.0.0"');
  });
});

describe("desktop updater manifest", () => {
  const assets = [
    { name: "Redshift_1.2.3_x64-setup.exe", signature: "WIN" },
    { name: "Redshift_1.2.3_universal.app.tar.gz", signature: "MAC" },
  ];

  test("requires Windows and both macOS architectures", () => {
    const manifest = buildManifest({
      version: "1.2.3",
      repo: REPO,
      tag: "v1.2.3",
      assets,
    });
    expect(
      REQUIRED_PLATFORMS.every((platform) => manifest.platforms[platform]),
    ).toBe(true);
    expect(manifest.platforms["windows-x86_64"].signature).toBe("WIN");
    expect(manifest.platforms["darwin-aarch64"].signature).toBe("MAC");
  });

  test("understands signed Tauri asset names", () => {
    expect(platformsForAsset("Redshift_1.2.3_x64.nsis.zip")).toContain(
      "windows-x86_64-nsis",
    );
    expect(platformsForAsset("Redshift_1.2.3_universal.app.tar.gz")).toContain(
      "darwin-aarch64",
    );
    expect(() =>
      buildManifest({
        version: "1.2.3",
        repo: REPO,
        tag: "v1.2.3",
        assets: [],
      }),
    ).toThrow();
  });
});
