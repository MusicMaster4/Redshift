import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { channelForBranch, resolveVersion } from "../src/lib/version.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const args = { channel: "stable", bump: "patch", dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--channel", "--bump", "--branch"].includes(argument)) args[argument.slice(2)] = argv[++index];
    else if (argument === "--dry-run") args.dryRun = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!args.bump) args.bump = "patch";
  if (args.branch) {
    const channel = channelForBranch(args.branch);
    if (!channel) throw new Error(`Branch ${args.branch} cannot publish. Use main or testing.`);
    args.channel = channel;
  }
  if (!["stable", "testing"].includes(args.channel)) throw new Error("Channel must be stable or testing.");
  if (!["patch", "minor", "major"].includes(args.bump)) throw new Error("Bump must be patch, minor, or major.");
  return args;
}

function tags() {
  return execFileSync("git", ["tag", "--list"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageVersion = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const version = resolveVersion({ channel: args.channel, tags: tags(), packageVersion, level: args.bump });
  const output = [`version=${version}`, `tag=v${version}`, `channel=${args.channel}`];
  console.log(output.join("\n"));
  if (process.env.GITHUB_OUTPUT && !args.dryRun) appendFileSync(process.env.GITHUB_OUTPUT, `${output.join("\n")}\n`);
}

if (import.meta.main) main();
