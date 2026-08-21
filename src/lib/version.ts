export const BETA_CHANNEL = "testing";
export const INITIAL_STABLE_VERSION = "1.0.0";
export type Channel = "stable" | "testing";
export type BumpLevel = "patch" | "minor" | "major";

export interface Version {
  major: number;
  minor: number;
  patch: number;
  channel: Channel;
  iteration: number;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-testing\.(\d+))?$/;

export function parseVersion(input: string): Version | null {
  const match = VERSION_RE.exec(input.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    channel: match[4] === undefined ? "stable" : "testing",
    iteration: match[4] === undefined ? 0 : Number(match[4]),
  };
}

export function formatVersion(version: Version): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.channel === "stable" ? base : `${base}-testing.${version.iteration}`;
}

export function channelOf(version: string): Channel {
  return parseVersion(version)?.channel ?? "stable";
}

export function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.channel !== b.channel) return a.channel === "stable" ? 1 : -1;
  return a.iteration - b.iteration;
}

export function isUpdateFor(current: string, candidate: string): boolean {
  const from = parseVersion(current);
  const to = parseVersion(candidate);
  return Boolean(from && to && from.channel === to.channel && compareVersions(to, from) > 0);
}

export function baseOf(version: Version): Version {
  return { ...version, channel: "stable", iteration: 0 };
}

export function bump(version: Version, level: BumpLevel = "patch"): Version {
  let { major, minor, patch } = version;
  if (level === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (level === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  if (patch > 99) {
    patch = 0;
    minor += 1;
  }
  if (minor > 99) {
    minor = 0;
    major += 1;
  }
  return { major, minor, patch, channel: "stable", iteration: 0 };
}

function parseTags(tags: readonly string[]): Version[] {
  return tags.map(parseVersion).filter((version): version is Version => version !== null);
}

function highest(versions: Version[]): Version | null {
  return versions.reduce<Version | null>((best, version) => (
    best === null || compareVersions(version, best) > 0 ? version : best
  ), null);
}

export function latestStable(tags: readonly string[]): Version | null {
  return highest(parseTags(tags).filter((version) => version.channel === "stable"));
}

function latestIteration(tags: readonly string[], base: Version): number {
  return parseTags(tags)
    .filter((version) => version.channel === "testing"
      && version.major === base.major
      && version.minor === base.minor
      && version.patch === base.patch)
    .reduce((maximum, version) => Math.max(maximum, version.iteration), 0);
}

export function resolveVersion(options: {
  channel: Channel;
  tags: readonly string[];
  packageVersion: string;
  level?: BumpLevel;
}): string {
  const packageVersion = parseVersion(options.packageVersion);
  if (!packageVersion) throw new Error(`Invalid Redshift version: ${options.packageVersion}`);
  const packageBase = baseOf(packageVersion);
  const stable = latestStable(options.tags);
  let base: Version;
  if (!stable && options.channel === "stable") {
    base = parseVersion(INITIAL_STABLE_VERSION)!;
  } else if (!stable) {
    base = packageBase;
  } else if (compareVersions(packageBase, stable) > 0) {
    base = packageBase;
  } else {
    base = bump(stable, options.level ?? "patch");
  }
  if (options.channel === "stable") return formatVersion(base);
  return formatVersion({ ...base, channel: "testing", iteration: latestIteration(options.tags, base) + 1 });
}

export function channelForBranch(branch: string): Channel | null {
  const name = branch.replace(/^refs\/heads\//, "");
  if (name === "main") return "stable";
  if (name === "testing") return "testing";
  return null;
}
