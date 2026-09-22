#!/usr/bin/env node

import { readFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const VERSIONS_DIR = join(ROOT, "versions");
const DATA_DIR = join(ROOT, "data");
const SOURCE_REPOSITORY =
  "https://github.com/DJB-Developer/wechat-android-history-versions";
const ALLOWED_DOWNLOAD_HOSTS = new Set(["dldir1.qq.com", "dldir1v6.qq.com"]);
const VERSION_PATTERN = /^\d+(?:\.\d+){1,2}$/;

function usage() {
  console.error("Usage: node scripts/generate.mjs <version.json>");
  process.exit(1);
}

function deriveVersion(entry) {
  const explicit = String(entry.version ?? "").trim();
  if (explicit) return explicit;

  const match = String(entry.name ?? "").match(/微信\s+([\d.]+)\s+for Android/i);
  return match?.[1] ?? "";
}

function normalizeEntry(entry, index) {
  const version = deriveVersion(entry);
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Entry ${index} has an invalid version: ${version || "(empty)"}`);
  }

  const publishDate = String(entry.publish_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishDate)) {
    throw new Error(`Entry ${index} has an invalid publish_date: ${publishDate}`);
  }

  const url = new URL(String(entry.url ?? "").trim());
  if (url.protocol !== "https:" || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) {
    throw new Error(`Entry ${index} has a non-official download URL: ${url}`);
  }
  if (!url.pathname.toLowerCase().endsWith(".apk")) {
    throw new Error(`Entry ${index} does not link to an APK: ${url}`);
  }

  return {
    version,
    name: `微信 ${version} for Android`,
    publish_date: publishDate,
    url: url.href,
    updated: Number(entry.updated) || null,
  };
}

function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const difference = (right[i] ?? 0) - (left[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|");
}

function versionReadme(version, entries) {
  const publishDate = entries[0].publish_date;
  const links = entries
    .map((entry, index) => {
      const fileName = basename(new URL(entry.url).pathname);
      const label = entries.length > 1 ? `官方下载 ${index + 1}` : "官方下载 APK";
      return `- [${label}: ${escapeMarkdown(fileName)}](${entry.url})`;
    })
    .join("\n");

  return `# 微信 ${version} for Android

微信 ${version} 安卓版发布于 ${publishDate}。本页汇总微信 ${version} for Android 的官方 APK 下载地址。

## 微信 ${version} 官方下载地址

${links}

## 版本信息

| 项目 | 内容 |
| --- | --- |
| 软件 | 微信 Android |
| 版本号 | ${version} |
| 发布日期 | ${publishDate} |
| APK 数量 | ${entries.length} |

下载链接指向腾讯官方域名 \`qq.com\`。安装历史版本前，请自行确认设备兼容性并备份重要数据。

[返回全部微信 Android 历史版本](../../README.md)

---

数据来源：[DJB-Developer/wechat-android-history-versions](${SOURCE_REPOSITORY})。本仓库是独立整理的版本索引，与微信或腾讯不存在隶属关系。
`;
}

function rootReadme(groups) {
  const rows = groups
    .map(([version, entries]) => {
      const date = entries[0].publish_date;
      return `| [微信 ${version} for Android](versions/${version}/) | ${date} | ${entries.length} |`;
    })
    .join("\n");

  return `# 微信 Android 历史版本官方下载

按版本号整理的微信 Android 历史版本索引。每个版本都有独立目录、独立一级标题和腾讯官方 APK 下载地址，便于搜索和查找。

## 微信 Android 版本列表

| 版本 | 发布日期 | 官方 APK 数量 |
| --- | --- | ---: |
${rows}

## 数据与更新

- 原始数据来源：[DJB-Developer/wechat-android-history-versions](${SOURCE_REPOSITORY})
- 下载链接仅允许腾讯官方域名 \`dldir1.qq.com\` 和 \`dldir1v6.qq.com\`
- \`data/version.json\` 保留经过规范化的原始条目
- \`versions/<版本号>/README.md\` 是按版本聚合的独立页面
- GitHub Actions 每天检查一次上游数据并自动生成变更

手动更新：

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/DJB-Developer/wechat-android-history-versions/main/version.json -o /tmp/wechat-version.json
node scripts/generate.mjs /tmp/wechat-version.json
\`\`\`

本仓库不提供 APK 文件托管，不是微信或腾讯的官方网站。安装历史版本可能带来兼容性或安全风险，请谨慎使用。
`;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) usage();

  const raw = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Input must be a non-empty JSON array");
  }

  const normalized = raw.map(normalizeEntry);
  const grouped = new Map();

  for (const entry of normalized) {
    const entries = grouped.get(entry.version) ?? [];
    if (!entries.some((existing) => existing.url === entry.url)) entries.push(entry);
    grouped.set(entry.version, entries);
  }

  const groups = [...grouped.entries()].sort(([a], [b]) => compareVersions(a, b));

  await rm(VERSIONS_DIR, { recursive: true, force: true });
  await mkdir(VERSIONS_DIR, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });

  for (const [version, entries] of groups) {
    const output = join(VERSIONS_DIR, version, "README.md");
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, versionReadme(version, entries), "utf8");
  }

  await writeFile(join(ROOT, "README.md"), rootReadme(groups), "utf8");
  await writeFile(
    join(DATA_DIR, "version.json"),
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );

  const generatedDirs = await readdir(VERSIONS_DIR);
  console.log(
    `Generated ${generatedDirs.length} version pages from ${normalized.length} APK entries.`,
  );
}

await main();
