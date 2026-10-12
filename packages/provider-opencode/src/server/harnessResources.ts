/**
 * Plugins and skills this build adds to every OpenCode server it starts, through
 * `OPENCODE_CONFIG_CONTENT`, the same way the user's own config would add them.
 *
 * They come from the directory `PAPRIKA_HARNESS_DIR` names:
 * - `opencode/v1/*.mjs`: OpenCode 1.x plugins. 2.x plugins use another API, so 2.x gets none.
 * - `skills/`: a folder of skill folders, for both generations.
 */
import * as NodeURL from "node:url";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { ProbedOpenCode } from "./versionProbe.ts";

export interface HarnessResources {
  /** `file:` URLs of the 1.x plugins, in name order. */
  readonly v1Plugins: ReadonlyArray<string>;
  readonly skillPaths: ReadonlyArray<string>;
}

/** Long enough for a tool that waits on the person, like a review window (1.x's default is 5 seconds). */
const HARNESS_MCP_TIMEOUT_MS = 30 * 60 * 1000;

const ConfigRecord = Schema.Record(Schema.String, Schema.Unknown);
const decodeConfig = Schema.decodeUnknownOption(Schema.fromJsonString(ConfigRecord));
const decodeRecord = Schema.decodeUnknownOption(ConfigRecord);
const decodeStrings = Schema.decodeUnknownOption(Schema.Array(Schema.String));
const decodeUnknowns = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));

export const readHarnessResources = Effect.fn("readHarnessResources")(function* (
  environment: Readonly<Record<string, string | undefined>>,
) {
  const root = environment.PAPRIKA_HARNESS_DIR;
  if (!root) return undefined;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const pluginDirectory = path.join(root, "opencode", "v1");
  const pluginNames = yield* fileSystem
    .readDirectory(pluginDirectory)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  const skills = path.join(root, "skills");
  const hasSkills = yield* fileSystem.exists(skills).pipe(Effect.orElseSucceed(() => false));
  return {
    v1Plugins: pluginNames
      .filter((name) => name.endsWith(".mjs"))
      .toSorted()
      .map((name) => NodeURL.pathToFileURL(path.join(pluginDirectory, name)).href),
    skillPaths: hasSkills ? [skills] : [],
  } satisfies HarnessResources;
});

/** The config content a server of this generation starts with, or undefined when there are no resources. */
export function harnessConfigContent(
  environment: Readonly<Record<string, string | undefined>>,
  resources: HarnessResources | undefined,
  generation: ProbedOpenCode["generation"],
): string | undefined {
  if (resources === undefined) return undefined;
  return withHarnessConfig(environment.OPENCODE_CONFIG_CONTENT ?? "{}", resources, generation);
}

const union = <A>(existing: ReadonlyArray<A>, added: ReadonlyArray<A>) => [
  ...new Set([...existing, ...added]),
];

/**
 * The config content with the harness resources added for one OpenCode generation. The user's
 * own entries stay, and content that isn't a JSON object is returned unchanged.
 */
export function withHarnessConfig(
  content: string,
  resources: HarnessResources,
  generation: ProbedOpenCode["generation"],
): string {
  const config = decodeConfig(content);
  if (Option.isNone(config)) return content;
  const existing = config.value;
  const strings = (value: unknown) => Option.getOrElse(decodeStrings(value), () => []);
  const record = (value: unknown) =>
    Option.getOrElse(decodeRecord(value), (): Readonly<Record<string, unknown>> => ({}));
  if (generation === "v2") {
    return JSON.stringify({
      ...existing,
      skills: union(strings(existing.skills), resources.skillPaths),
    });
  }
  const plugins = Option.getOrElse(decodeUnknowns(existing.plugin), () => []);
  const skills = record(existing.skills);
  const experimental = record(existing.experimental);
  return JSON.stringify({
    ...existing,
    plugin: union(plugins, resources.v1Plugins),
    skills: { ...skills, paths: union(strings(skills.paths), resources.skillPaths) },
    experimental: {
      ...experimental,
      mcp_timeout: Math.max(
        typeof experimental.mcp_timeout === "number" ? experimental.mcp_timeout : 0,
        HARNESS_MCP_TIMEOUT_MS,
      ),
    },
  });
}
