import { describe, expect, test } from "vitest";

import { channelForBranch, isUpdateFor, resolveVersion } from "./version";

describe("release channels", () => {
  test("maps only main and testing", () => {
    expect(channelForBranch("main")).toBe("stable");
    expect(channelForBranch("testing")).toBe("testing");
    expect(channelForBranch("feature/x")).toBeNull();
  });

  test("keeps updates inside their channel", () => {
    expect(isUpdateFor("1.0.0", "1.0.1")).toBe(true);
    expect(isUpdateFor("1.0.0", "1.0.1-testing.1")).toBe(false);
    expect(isUpdateFor("1.0.1-testing.1", "1.0.1-testing.2")).toBe(true);
    expect(isUpdateFor("1.0.1-testing.1", "1.0.1")).toBe(false);
  });

  test("builds beta versions toward the next stable", () => {
    const tags = ["v1.0.2", "v1.0.3-testing.1"];
    expect(resolveVersion({ channel: "testing", tags, packageVersion: "1.0.0" })).toBe("1.0.3-testing.2");
    expect(resolveVersion({ channel: "stable", tags, packageVersion: "1.0.0" })).toBe("1.0.3");
  });
});
