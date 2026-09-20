// SDF repo indexer (07 §6), incremental by sha256.
import { existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { sha256Hex } from "../lib/ids.ts";
import { addEdge, clearFileEdges, deleteSdfObjectsForFile, fileShas, getRepo, removeCodeFile, updateRepo, upsertCodeFile, upsertSdfObject, type Repo } from "../db/repo/code.ts";
import { tx } from "../db/db.ts";
import { now } from "../lib/ids.ts";
import { analyzeScript } from "./script-analyzer.ts";
import { parseSdfObject } from "./sdf-parser.ts";
import { headCommit, isGitRepo } from "./git.ts";
import { dataPath } from "../lib/fs.ts";

const IGNORE = /(^|\/)(node_modules|\.git|\.attach_to_nsic|dist|build|coverage)(\/|$)/;
const CODE_EXT = /\.(js|ts|mjs|cjs)$/i;
const MAX_FILE = 2 * 1024 * 1024;

export function repoDir(repo: Repo): string {
  return repo.source === "git_url" ? dataPath("repos", repo.id) : repo.location;
}

export async function findSdfRoot(dir: string): Promise<{ root: string; projectType: Repo["project_type"] }> {
  for await (const p of new Bun.Glob("**/manifest.xml").scan({ cwd: dir, onlyFiles: true })) {
    if (IGNORE.test(p)) continue;
    const xml = await Bun.file(join(dir, p)).text();
    const pt = /projecttype\s*=\s*"(\w+)"/i.exec(xml)?.[1]?.toUpperCase();
    const root = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    return { root, projectType: pt === "SUITEAPP" ? "SUITEAPP" : "ACCOUNTCUSTOMIZATION" };
  }
  return { root: "", projectType: "NONE" };
}

/** Repo path → File Cabinet path ('/SuiteScripts/x.js') when under src/FileCabinet. */
export function fileCabinetPath(repoRel: string, sdfRoot: string): string | null {
  const prefix = `${sdfRoot ? sdfRoot + "/" : ""}FileCabinet`;
  return repoRel.startsWith(prefix + "/") ? repoRel.slice(prefix.length) : null;
}

export type IndexStats = { scanned: number; changed: number; removed: number; objects: number; commit: string | null };

export async function indexRepo(repoId: string): Promise<IndexStats> {
  const repo = getRepo(repoId);
  if (!repo) throw new Error("repo not found");
  const dir = repoDir(repo);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`repo folder does not exist: ${dir}`);
  const { root, projectType } = await findSdfRoot(dir);
  const known = fileShas(repoId);
  const seen = new Set<string>();
  let changed = 0;
  let objects = 0;
  const fcToRepo = new Map<string, string>();
  const pendingObjects: { rel: string; xml: string }[] = [];

  for await (const rel0 of new Bun.Glob("**/*").scan({ cwd: dir, onlyFiles: true, dot: false })) {
    const rel = rel0.split(sep).join("/");
    if (IGNORE.test(rel)) continue;
    const isCode = CODE_EXT.test(rel);
    const isObj = /\/Objects\/.*\.xml$|^Objects\/.*\.xml$/.test(rel);
    if (!isCode && !isObj && !/(manifest|deploy)\.xml$/.test(rel)) continue;
    const f = Bun.file(join(dir, rel));
    if (f.size > MAX_FILE) continue;
    seen.add(rel);
    const fc = fileCabinetPath(rel, root);
    if (fc) fcToRepo.set(fc, rel);
    const content = await f.text();
    const sha = await sha256Hex(content);
    if (known.get(rel)?.sha256 === sha) {
      if (isObj) objects++;
      continue;
    }
    changed++;
    tx(() => {
      if (isCode) {
        const info = analyzeScript(content);
        upsertCodeFile({ repo_id: repoId, path: rel, sha256: sha, kind: info.scriptType ? "suitescript" : "other", script_type: info.scriptType, api_version: info.apiVersion, modules: info.modules, entry_points: info.entryPoints, size_bytes: f.size }, content);
        clearFileEdges(repoId, rel);
        const node = `file:${rel}`;
        for (const m of info.modules) addEdge(repoId, node, `mod:${m}`, "imports");
        for (const fl of info.readsFields) addEdge(repoId, node, `fld:${fl}`, "reads_field");
        for (const fl of info.writesFields) addEdge(repoId, node, `fld:${fl}`, "writes_field");
        for (const r of info.recordTypesTouched) addEdge(repoId, node, `rec:${r}`, "touches_record");
      } else {
        upsertCodeFile({ repo_id: repoId, path: rel, sha256: sha, kind: "object_xml", script_type: null, api_version: null, modules: [], entry_points: [], size_bytes: f.size }, content);
        if (isObj) pendingObjects.push({ rel, xml: content });
      }
    });
    if (isObj) objects++;
  }

  // Objects are processed after all files are read so 'implements' can point at repo files.
  for (const { rel, xml } of pendingObjects) {
    let parsed;
    try {
      parsed = parseSdfObject(xml);
    } catch {
      parsed = null;
    }
    tx(() => {
      deleteSdfObjectsForFile(repoId, rel);
      if (!parsed) return;
      upsertSdfObject({ repo_id: repoId, scriptid: parsed.scriptid, object_type: parsed.objectType, file_path: rel, attrs: parsed.attrs });
      for (const c of parsed.children) upsertSdfObject({ repo_id: repoId, scriptid: c.scriptid, object_type: c.objectType, file_path: rel, attrs: c.attrs });
      for (const e of parsed.edges) {
        if (e.dst.startsWith("fc:")) {
          const fc = e.dst.slice(3);
          const repoRel = fcToRepo.get(fc);
          addEdge(repoId, e.src, repoRel ? `file:${repoRel}` : `fc:${fc}`, e.rel);
        } else addEdge(repoId, e.src, e.dst, e.rel);
      }
    });
  }

  let removed = 0;
  for (const [path] of known) {
    if (!seen.has(path)) {
      tx(() => {
        deleteSdfObjectsForFile(repoId, path);
        removeCodeFile(repoId, path);
      });
      removed++;
    }
  }
  const commit = (await isGitRepo(dir)) ? await headCommit(dir) : null;
  updateRepo(repoId, { sdf_root: root, project_type: projectType, last_indexed_at: now(), last_indexed_commit: commit && commit.ok ? commit.value : null });
  return { scanned: seen.size, changed, removed, objects, commit: commit && commit.ok ? commit.value : null };
}

export { relative };
