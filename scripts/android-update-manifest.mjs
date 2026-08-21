import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function androidAssetName(channel) {
  if (channel === "stable") return "redshift.apk";
  if (channel === "testing") return "redshift-beta.apk";
  throw new Error(`Unsupported Android update channel: ${channel}`);
}

export function buildAndroidManifest({ channel, version, versionCode, repo, tag, sha256, publishedAt = new Date().toISOString() }) {
  const code = Number(versionCode);
  if (!Number.isSafeInteger(code) || code < 1) throw new Error("versionCode must be a positive integer.");
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error("sha256 must contain 64 hexadecimal characters.");
  const asset = androidAssetName(channel);
  return {
    schema_version: 1,
    channel,
    version,
    version_code: code,
    url: `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${asset}`,
    sha256: sha256.toLowerCase(),
    published_at: publishedAt,
  };
}

export function parseArgs(argv) {
  const args = { repo: process.env.GITHUB_REPOSITORY || "MusicMaster4/Redshift", bundleDir: "release-assets", out: "android-latest.json" };
  const keys = {
    "--channel": "channel", "--version": "version", "--version-code": "versionCode",
    "--repo": "repo", "--tag": "tag", "--bundle-dir": "bundleDir", "--out": "out",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = keys[argv[index]];
    if (!key) throw new Error(`Unknown argument: ${argv[index]}`);
    args[key] = argv[++index];
  }
  for (const key of ["channel", "version", "versionCode", "tag"]) if (!args[key]) throw new Error(`${key} is required.`);
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const directory = path.isAbsolute(args.bundleDir) ? args.bundleDir : path.join(ROOT, args.bundleDir);
  const apk = path.join(directory, androidAssetName(args.channel));
  const sha256 = createHash("sha256").update(readFileSync(apk)).digest("hex");
  const manifest = buildAndroidManifest({ ...args, sha256 });
  const output = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${args.out}: ${manifest.version} (${manifest.channel}).`);
}

if (import.meta.main) main();
