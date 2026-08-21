import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { channelOf, parseVersion } from "../src/lib/version.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CRATE = "redshift";
export const DEFAULT_REPO = "MusicMaster4/Redshift";
export const BETA_POINTER_TAG = "channel-testing";

export function endpointFor(channel, repo = DEFAULT_REPO) {
  return channel === "testing"
    ? `https://github.com/${repo}/releases/download/${BETA_POINTER_TAG}/latest.json`
    : `https://github.com/${repo}/releases/latest/download/latest.json`;
}

export function withPackageVersion(pkg, version) {
  return { ...pkg, version };
}

export function withTauriConfig(config, { version, channel, repo = DEFAULT_REPO }) {
  const updater = { ...(config.plugins?.updater ?? {}), endpoints: [endpointFor(channel, repo)] };
  return { ...config, version, plugins: { ...(config.plugins ?? {}), updater } };
}

export function withCargoVersion(text, version) {
  let inPackage = false;
  let replaced = false;
  const result = text.split("\n").map((line) => {
    const section = /^\s*\[([^\]]+)\]/.exec(line);
    if (section) inPackage = section[1] === "package";
    else if (inPackage && !replaced && /^\s*version\s*=/.test(line)) {
      replaced = true;
      return `version = "${version}"`;
    }
    return line;
  }).join("\n");
  if (!replaced) throw new Error("Cargo package version was not found.");
  return result;
}

export function withCargoLockVersion(text, crate, version) {
  const pattern = new RegExp(`(name = "${crate}"\\r?\\n)version = "[^"]*"`);
  if (!pattern.test(text)) throw new Error(`Crate ${crate} was not found in Cargo.lock.`);
  return text.replace(pattern, `$1version = "${version}"`);
}

export function parseArgs(argv) {
  const args = { repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--version", "--channel", "--repo"].includes(argument)) args[argument.slice(2)] = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!args.version || !parseVersion(args.version)) throw new Error("Version must be X.Y.Z or X.Y.Z-testing.N.");
  const impliedChannel = channelOf(args.version);
  args.channel ||= impliedChannel;
  if (args.channel !== impliedChannel) throw new Error(`Version ${args.version} belongs to ${impliedChannel}.`);
  return args;
}

function editJson(file, edit) {
  const target = path.join(ROOT, file);
  writeFileSync(target, `${JSON.stringify(edit(JSON.parse(readFileSync(target, "utf8"))), null, 2)}\n`);
}

function editText(file, edit) {
  const target = path.join(ROOT, file);
  writeFileSync(target, edit(readFileSync(target, "utf8")));
}

function main() {
  const { version, channel, repo } = parseArgs(process.argv.slice(2));
  editJson("package.json", (pkg) => withPackageVersion(pkg, version));
  editJson("src-tauri/tauri.conf.json", (config) => withTauriConfig(config, { version, channel, repo }));
  editText("src-tauri/Cargo.toml", (text) => withCargoVersion(text, version));
  editText("src-tauri/Cargo.lock", (text) => withCargoLockVersion(text, CRATE, version));
  console.log(`Applied ${version} with the ${channel} update feed.`);
}

if (import.meta.main) main();
