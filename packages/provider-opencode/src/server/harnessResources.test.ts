import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { describe, expect, it } from "vite-plus/test";

import { readHarnessResources, withHarnessConfig } from "./harnessResources.ts";

const resources = {
  v1Plugins: ["file:///harness/opencode/v1/paprika.mjs"],
  skillPaths: ["/harness/skills"],
};

describe("withHarnessConfig", () => {
  it("adds 1.x plugins and skill paths beside the user's own, once", () => {
    const user = JSON.stringify({
      model: "anthropic/claude",
      plugin: ["user-plugin"],
      skills: { paths: ["/user/skills"], urls: ["https://example.com/skills"] },
    });
    const once = withHarnessConfig(user, resources, "v1");
    expect(JSON.parse(once)).toEqual({
      model: "anthropic/claude",
      plugin: ["user-plugin", "file:///harness/opencode/v1/paprika.mjs"],
      skills: { paths: ["/user/skills", "/harness/skills"], urls: ["https://example.com/skills"] },
      experimental: { mcp_timeout: 1_800_000 },
    });
    expect(withHarnessConfig(once, resources, "v1")).toBe(once);
  });

  it("keeps a longer MCP timeout the user set", () => {
    const config = withHarnessConfig('{"experimental":{"mcp_timeout":7200000}}', resources, "v1");
    expect(JSON.parse(config).experimental.mcp_timeout).toBe(7_200_000);
  });

  it("gives 2.x skill paths in its array shape and no 1.x plugins", () => {
    const config = withHarnessConfig('{"skills":["/user/skills"]}', resources, "v2");
    expect(JSON.parse(config)).toEqual({ skills: ["/user/skills", "/harness/skills"] });
  });

  it("leaves content that is not a JSON object unchanged", () => {
    expect(withHarnessConfig("not json", resources, "v1")).toBe("not json");
  });
});

describe("readHarnessResources", () => {
  effectIt.effect("returns nothing without PAPRIKA_HARNESS_DIR", () =>
    Effect.gen(function* () {
      expect(yield* readHarnessResources({})).toBe(undefined);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  effectIt.effect("lists 1.x plugins in name order and the skills folder", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped();
      const pluginDirectory = path.join(root, "opencode", "v1");
      yield* fileSystem.makeDirectory(pluginDirectory, { recursive: true });
      yield* fileSystem.makeDirectory(path.join(root, "skills"));
      for (const name of ["b.mjs", "a.mjs", "notes.txt"]) {
        yield* fileSystem.writeFileString(path.join(pluginDirectory, name), "");
      }
      const found = yield* readHarnessResources({ PAPRIKA_HARNESS_DIR: root });
      expect(found?.v1Plugins.map((url) => url.split("/").pop())).toEqual(["a.mjs", "b.mjs"]);
      expect(found?.skillPaths).toEqual([path.join(root, "skills")]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
