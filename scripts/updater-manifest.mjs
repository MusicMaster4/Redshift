import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseVersion } from "../src/lib/version.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS_ARTIFACT = /-setup\.exe(?:\.zip)?$|\.nsis\.zip$/;
const MACOS_ARTIFACT = /\.app\.tar\.gz$/;

export const REQUIRED_PLATFORMS = [
  "windows-x86_64",
  "windows-x86_64-nsis",
  "darwin-x86_64",
  "darwin-x86_64-app",
  "darwin-aarch64",
  "darwin-aarch64-app",
];

export function downloadUrl(repo, tag, assetName) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

export function collectAssets(directory, { readdir = readdirSync, readFile } = {}) {
  const read = readFile ?? ((file) => readFileSync(file, "utf8"));
  return readdir(directory, { recursive: true, withFileTypes: false })
    .map((entry) => String(entry).split(path.sep).join("/"))
    .filter((entry) => entry.endsWith(".sig"))
    .map((entry) => ({
      name: entry.slice(entry.lastIndexOf("/") + 1, -4),
      signature: read(path.join(directory, entry)).trim(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function platformsForAsset(name) {
  if (WINDOWS_ARTIFACT.test(name)) return ["windows-x86_64", "windows-x86_64-nsis"];
  if (MACOS_ARTIFACT.test(name) && /universal/i.test(name)) {
    return ["darwin-x86_64", "darwin-x86_64-app", "darwin-aarch64", "darwin-aarch64-app"];
  }
  return [];
}

export function buildManifest({ version, repo, tag, notes = "", pubDate = new Date().toISOString(), assets }) {
  if (!parseVersion(version)) throw new Error(`Invalid Redshift version: ${version}`);
  const platforms = {};
  for (const asset of assets) {
    const entry = { signature: asset.signature, url: downloadUrl(repo, tag, asset.name) };
    for (const platform of platformsForAsset(asset.name)) {
      if (platforms[platform]) throw new Error(`More than one updater artifact targets ${platform}.`);
      platforms[platform] = entry;
    }
  }
  const missing = REQUIRED_PLATFORMS.filter((platform) => !platforms[platform]);
  if (missing.length) throw new Error(`Missing signed updater artifacts for: ${missing.join(", ")}`);
  return { version, notes, pub_date: pubDate, platforms };
}

export function parseArgs(argv) {
  const args = {
    repo: process.env.GITHUB_REPOSITORY || "MusicMaster4/Redshift",
    bundleDir: "release-assets",
    out: "latest.json",
    notes: "",
  };
  const keys = { "--version": "version", "--tag": "tag", "--repo": "repo", "--notes": "notes", "--bundle-dir": "bundleDir", "--out": "out" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = keys[argv[index]];
    if (!key) throw new Error(`Unknown argument: ${argv[index]}`);
    args[key] = argv[++index];
  }
  if (!args.version) throw new Error("--version is required.");
  args.tag ||= `v${args.version}`;
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const directory = path.isAbsolute(args.bundleDir) ? args.bundleDir : path.join(ROOT, args.bundleDir);
  const manifest = buildManifest({ ...args, assets: collectAssets(directory) });
  const output = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${args.out}: ${REQUIRED_PLATFORMS.length} desktop update targets.`);
}

if (import.meta.main) main();
