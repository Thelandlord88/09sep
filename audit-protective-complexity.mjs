#!/usr/bin/env node
/**
 * Protective Complexity Audit (no deps, rg optional)
 * - Scans for redirects/aliases, duplicate URL truths, Tailwind/PostCSS pileups,
 *   multi-config sprawl, TODO/HACK landmines, legacy closet leaks, and feature flags.
 * - Emits a machine-readable report and Upstream Coach JSON stubs.
 *
 * Usage:
 *   node tools/audit-protective-complexity.mjs --write
 *   node tools/audit-protective-complexity.mjs --json reports/audit/protective-complexity.json
 */

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";

const CWD = process.cwd();
const OUT_DIR = path.join(CWD, "reports", "audit");
const OUT_JSON = process.argv.includes("--json")
  ? process.argv[process.argv.indexOf("--json") + 1]
  : path.join(OUT_DIR, "protective-complexity.json");
const WRITE = process.argv.includes("--write");

// ----------------------------- helpers --------------------------------
const IGNORES = new Set([".git", "node_modules", "dist", "build", ".next", ".astro", ".vercel", "coverage", ".cache"]);

function hasRg() {
  const r = spawnSync("rg", ["--version"], { stdio: "pipe" });
  return r.status === 0;
}

function runRg(args) {
  const r = spawnSync("rg", ["-n", ...args], { encoding: "utf8" });
  if (r.status === 2) throw new Error(r.stderr || "ripgrep error");
  return r.stdout.trim();
}

async function* walk(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (IGNORES.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(p);
    } else {
      yield p;
    }
  }
}

async function searchFs(regex, options = {}) {
  const hits = [];
  const maxBytes = options.maxBytes ?? 1024 * 1024; // 1MB
  for await (const file of walk(CWD)) {
    if (options.pathsOnly && !options.pathsOnly.some((p) => file.includes(p))) continue;
    if (options.pathsNot && options.pathsNot.some((p) => file.includes(p))) continue;
    try {
      const stat = await fsp.stat(file);
      if (stat.size > maxBytes) continue;
      const text = await fsp.readFile(file, "utf8");
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (regex.test(line)) {
          hits.push({ file: path.relative(CWD, file), line: i + 1, match: line.trim().slice(0, 240) });
        }
      });
    } catch {}
  }
  return hits;
}

function uniqueBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter((x) => {
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// --------------------------- detectors ---------------------------------
const detectors = [
  {
    key: "redirects_aliases",
    description: "Legacy redirects/aliases (cluster paths, middleware, _redirects, alias expanders)",
    rg: [
      '("redirect"|"_redirects"|addRedirect|middleware|alias|/blog/(ipswich|brisbane|logan)/)',
      "--glob",
      "!dist",
      "--glob",
      "!node_modules",
    ],
    fallback: { regex: /(redirect|_redirects|addRedirect|middleware|alias|\/blog\/(ipswich|brisbane|logan)\/)/i },
  },
  {
    key: "duplicate_url_truths",
    description: "Literal '/blog/' links outside the route builder",
    custom: async () => {
      const hits = await searchFs(/\/blog\//, { pathsNot: ["lib/routes/blog", "lib/routes/blog.ts", "routes/blog"] });
      return hits.filter((h) => h.file.match(/\.(astro|ts|tsx|js|md|mdx|html)$/));
    },
  },
  {
    key: "tailwind_postcss_pileup",
    description: "Redundant PostCSS plugins with Tailwind v4 (@tailwindcss/postcss should be the only one)",
    rg: ["(postcss-nesting|autoprefixer|plugins\\s*:)", "postcss.config.*", "tailwind.config.*", "src", "styles"],
    fallback: { regex: /(postcss-nesting|autoprefixer|plugins\s*:)/i, pathsOnly: ["postcss.config", "tailwind.config", "src", "styles"] },
  },
  {
    key: "multi_config_sprawl",
    description: "Multiple configs for same concern (eslint/prettier/stylelint/husky/lint-staged/commitlint)",
    rg: ["(eslint|prettier|stylelint|husky|lint-staged|commitlint)", "--glob", "!node_modules"],
    fallback: { regex: /(eslint|prettier|stylelint|husky|lint-staged|commitlint)/i },
  },
  {
    key: "todo_hack_debt",
    description: "TODO/FIXME/TEMP/HACK/WORKAROUND/HOTFIX/DEBT markers",
    rg: ["(TODO|FIXME|TEMP|HACK|WORKAROUND|HOTFIX|DEBT)", "--glob", "!dist", "--glob", "!node_modules"],
    fallback: { regex: /(TODO|FIXME|TEMP|HACK|WORKAROUND|HOTFIX|DEBT)/ },
  },
  {
    key: "legacy_closet_leaks",
    description: "References to /legacy or /_attic in production code",
    rg: ["(/legacy|/_attic)", "src", "pages"],
    fallback: { regex: /(\/legacy|\/_attic)/, pathsOnly: ["src", "pages"] },
  },
  {
    key: "feature_flags",
    description: "ENABLE_/DISABLE_/FEATURE_/FLAG style gates masking design debt",
    rg: ["(ENABLE_|DISABLE_|FEATURE_|FLAG)", "src", "pages"],
    fallback: { regex: /(ENABLE_|DISABLE_|FEATURE_|FLAG)/, pathsOnly: ["src", "pages"] },
  },
  {
    key: "sitemap_rss_mentions",
    description: "Sitemap/RSS plumbing (for parity checks later)",
    rg: ["(sitemap|rss|feed|/sitemap.xml|/rss.xml)", "src", "pages", "scripts", "tools"],
    fallback: { regex: /(sitemap|rss|feed|\/sitemap\.xml|\/rss\.xml)/i, pathsOnly: ["src", "pages", "scripts", "tools"] },
  },
  {
    key: "jsonld_schema",
    description: "JSON-LD schema mentions (for snapshot stability)",
    rg: ["(JSON-LD|schema|BlogPosting|LocalBusiness|FAQPage)", "src"],
    fallback: { regex: /(JSON-LD|schema|BlogPosting|LocalBusiness|FAQPage)/i, pathsOnly: ["src"] },
  },
];

async function runDetector(det, hasRipgrep) {
  if (det.custom) return uniqueBy(await det.custom(), (h) => `${h.file}:${h.line}:${h.match}`);
  if (hasRipgrep && det.rg) {
    const out = runRg(det.rg);
    const hits = out
      ? out.split("\n").map((line) => {
          const m = line.match(/^(.+?):(\d+):(.*)$/);
          if (!m) return null;
          return { file: path.relative(CWD, m[1]), line: Number(m[2]), match: m[3].trim().slice(0, 240) };
        })
      : [];
    return uniqueBy(hits.filter(Boolean), (h) => `${h.file}:${h.line}:${h.match}`);
  }
  // fallback
  const fb = det.fallback ?? { regex: /$^/ };
  const hits = await searchFs(fb.regex, fb);
  return uniqueBy(hits, (h) => `${h.file}:${h.line}:${h.match}`);
}

// ---------------------------- stubs ------------------------------------
function makeCoachStub(kind, hits) {
  const last90 = "last_90_days";
  const common = {
    policy_invariant: "",
    sibling_sweep: { pattern: "", hits: hits.slice(0, 50).map((h) => `${h.file}:${h.line}`), actions: [] },
    evidence_window: last90,
    rollback_plan: "Revert the PR; keep removed lines archived under docs/ops/."
  };

  if (kind === "redirects_aliases") {
    return {
      box: "Legacy redirects/aliases likely protecting old URL decisions",
      closet: "Single URL truth via route helpers + curated, evidence-backed redirects",
      ablation: "Delete redirects: internal nav fine; only external legacy links may 404",
      upstream_candidates: ["Early cluster paths", "No single source of truth for URLs"],
      chosen_change: {
        description: "Remove non-evidenced redirects; keep only entries with inbound traffic in last_90_days",
        deletions: ["public/_redirects (non-evidenced lines)", "scripts/*alias*.mjs"],
        single_source_of_truth: "src/lib/routes/blog.ts"
      },
      policy_invariant: "CI: forbid literal '/blog/' outside routes module; sitemap-only canonicals",
      ...common,
      sibling_sweep: { pattern: "/blog/(ipswich|brisbane|logan)/", hits: common.sibling_sweep.hits, actions: [] }
    };
  }

  if (kind === "duplicate_url_truths") {
    return {
      box: "Literal '/blog/' scattered across code vs centralized route builder",
      closet: "src/lib/routes/blog.ts (one URL truth)",
      ablation: "Remove literals: all links flow through helpers; drift ends",
      upstream_candidates: ["Ad-hoc links before routes module"],
      chosen_change: {
        description: "Replace literals with helpers; add CI grep guard",
        deletions: ["Hard-coded '/blog/' in components/pages"],
        single_source_of_truth: "src/lib/routes/blog.ts"
      },
      policy_invariant: "CI: rg must return 0 for '/blog/' outside routes module",
      ...common,
      sibling_sweep: { pattern: "/blog/", hits: common.sibling_sweep.hits, actions: [] }
    };
  }

  if (kind === "tailwind_postcss_pileup") {
    return {
      box: "Redundant PostCSS plugins with Tailwind v4 causing syntax flakiness",
      closet: "Single Tailwind v4 pipeline via @tailwindcss/postcss",
      ablation: "Drop extra plugins: styles still compile, fewer errors",
      upstream_candidates: ["Historical PostCSS config", "Mixed guidance during upgrade"],
      chosen_change: {
        description: "Use only @tailwindcss/postcss; remove nesting/autoprefixer; fix content globs",
        deletions: ["postcss-nesting", "autoprefixer", "stray plugin configs"],
        single_source_of_truth: "postcss.config.cjs"
      },
      policy_invariant: "CI compiles a nested CSS sample; Tailwind content globs include *.astro/*.mdx",
      ...common,
      sibling_sweep: { pattern: "postcss-(nest|preset)|autoprefixer", hits: common.sibling_sweep.hits, actions: [] }
    };
  }

  return {
    box: `Candidate: ${kind}`,
    closet: "TBD",
    ablation: "TBD",
    upstream_candidates: [],
    chosen_change: { description: "TBD", deletions: [], single_source_of_truth: "" },
    ...common
  };
}

// ----------------------------- main ------------------------------------
const RG = hasRg();

const results = {
  meta: {
    repoRoot: CWD,
    rgAvailable: RG,
    generatedAt: new Date().toISOString(),
  },
  detectors: {},
  coach_stubs: [],
};

for (const det of detectors) {
  const hits = await runDetector(det, RG);
  results.detectors[det.key] = {
    description: det.description,
    total: hits.length,
    sample: hits.slice(0, 50),
  };
  // auto-stub select high-signal detectors
  if (["redirects_aliases", "duplicate_url_truths", "tailwind_postcss_pileup"].includes(det.key) && hits.length) {
    results.coach_stubs.push(makeCoachStub(det.key, hits));
  }
}

// ensure out dir
await fsp.mkdir(OUT_DIR, { recursive: true });
if (WRITE) {
  await fsp.writeFile(OUT_JSON, JSON.stringify(results, null, 2), "utf8");
  console.log(`✔ Wrote audit to ${path.relative(CWD, OUT_JSON)}\n`);
} else {
  console.log(JSON.stringify(results, null, 2));
}
