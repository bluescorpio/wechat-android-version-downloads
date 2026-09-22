#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DATA_PATH = join(ROOT, "data", "version.json");
const VERSIONS_DIR = join(ROOT, "versions");

const entries = JSON.parse(await readFile(DATA_PATH, "utf8"));
const rootReadme = await readFile(join(ROOT, "README.md"), "utf8");
const versions = new Map();

for (const entry of entries) {
  const list = versions.get(entry.version) ?? [];
  list.push(entry);
  versions.set(entry.version, list);
}

const directories = await readdir(VERSIONS_DIR);
if (directories.length !== versions.size) {
  throw new Error(
    `Expected ${versions.size} version directories, found ${directories.length}`,
  );
}

for (const [version, versionEntries] of versions) {
  const pagePath = join(VERSIONS_DIR, version, "README.md");
  await access(pagePath);
  const page = await readFile(pagePath, "utf8");

  if (!page.startsWith(`# 微信 ${version} for Android\n`)) {
    throw new Error(`Unexpected title in ${pagePath}`);
  }
  if (!rootReadme.includes(`](versions/${version}/)`)) {
    throw new Error(`Root README does not link to version ${version}`);
  }

  for (const entry of versionEntries) {
    if (!page.includes(entry.url)) {
      throw new Error(`Version page ${version} does not contain ${entry.url}`);
    }
  }
}

console.log(
  `Checked ${versions.size} version pages and ${entries.length} official APK links.`,
);
