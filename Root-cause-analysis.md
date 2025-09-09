# Root-cause analysis: lurking errors and upstream fixes

Date: 2025-09-08
Context: Applying upstream-first thinking to eliminate error classes

## Current symptom analysis

From repo-health.sh output, we have 3 red flags:

1. ✗ CSS imports in source: 1 (review for duplicates)
2. ✗ Legacy @tailwind base/components/utilities found  
3. ✗ Potential reset/normalize conflicts found

## 5 Whys analysis for each symptom

### Symptom 1: CSS imports in source
**Why 1:** Script flags CSS import in src/layouts/MainLayout.astro
**Why 2:** We need global styles somewhere in the component tree
**Why 3:** Astro requires explicit imports (no auto-injection like Next.js)
**Why 4:** We have one global CSS file that must be imported
**Why 5:** This is actually correct behavior - false positive from script

**Root cause:** Script heuristic is too broad (flags legitimate single global import)
**Class elimination:** Update script to flag >1 CSS imports, not any CSS imports

### Symptom 2: Legacy @tailwind directives found
**Why 1:** Script found @tailwind base/components/utilities in src/
**Why 2:** File src/styles/main.css.backup contains old directives
**Why 3:** Backup file left behind during v4 migration
**Why 4:** No cleanup process for .backup files
**Why 5:** No invariant preventing legacy syntax accumulation

**Root cause:** Incomplete migration cleanup + no safeguards against regression
**Class elimination:** Remove all .backup files + add invariant test

### Symptom 3: Reset/normalize conflicts
**Why 1:** Script found "reset" string in CSS
**Why 2:** Comment "Base: resets & typography" in main.css triggered false positive  
**Why 3:** Grep pattern too broad (matches comments, not just imports)
**Why 4:** No distinction between comment mentions vs actual imports
**Why 5:** Heuristic designed for catching normalize.css imports, not comments

**Root cause:** Over-broad pattern matching in health script
**Class elimination:** Improve grep pattern to match only import statements

## Class-eliminating fixes

### Fix 1: Improve repo-health.sh precision
**Current issue:** False positives reduce trust in health checks
**Class eliminated:** Noisy health checks that cry wolf
**Solution:** Tighten patterns to match actual problems, not shadows

### Fix 2: Add backup file cleanup + prevention
**Current issue:** .backup files accumulate and confuse tooling
**Class eliminated:** Migration artifacts left behind
**Solution:** 
- Remove existing .backup files
- Add .gitignore pattern for *.backup
- Add invariant test: no .backup files in src/

### Fix 3: Create invariant test suite
**Current issue:** No automated prevention of regression
**Class eliminated:** Silent drift back to old patterns  
**Solution:** Vitest tests that fail if anti-patterns reappear

## Implementation: invariant tests

**tests/invariants/css-pipeline.spec.ts**
```typescript
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

describe('CSS pipeline invariants', () => {
  test('no backup files in src/', () => {
    const findBackups = (dir: string): string[] => {
      const items = readdirSync(dir, { withFileTypes: true });
      let backups: string[] = [];
      
      for (const item of items) {
        const path = join(dir, item.name);
        if (item.isDirectory()) {
          backups.push(...findBackups(path));
        } else if (item.name.includes('.backup')) {
          backups.push(path);
        }
      }
      return backups;
    };
    
    const backups = findBackups('src');
    expect(backups).toEqual([]);
  });

  test('no legacy @tailwind directives in src/', () => {
    // Recursive file search for legacy patterns
    const hasLegacyDirectives = (dir: string): string[] => {
      const items = readdirSync(dir, { withFileTypes: true });
      let violations: string[] = [];
      
      for (const item of items) {
        const path = join(dir, item.name);
        if (item.isDirectory()) {
          violations.push(...hasLegacyDirectives(path));
        } else if (item.name.endsWith('.css')) {
          const content = readFileSync(path, 'utf8');
          if (/@tailwind\s+(base|components|utilities);/.test(content)) {
            violations.push(path);
          }
        }
      }
      return violations;
    };
    
    const violations = hasLegacyDirectives('src');
    expect(violations).toEqual([]);
  });

  test('exactly one CSS import in layouts', () => {
    const layoutDir = 'src/layouts';
    if (!existsSync(layoutDir)) return;
    
    const files = readdirSync(layoutDir)
      .filter(f => f.endsWith('.astro'))
      .map(f => join(layoutDir, f));
    
    let totalCssImports = 0;
    
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const matches = content.match(/import\s+['"][^'"]+\.css['"]/g) || [];
      totalCssImports += matches.length;
    }
    
    // Exactly one global CSS import across all layouts
    expect(totalCssImports).toBe(1);
  });
});
```

## Sibling sweep: what else needs attention?

**Similar backup file patterns:**
```bash
find . -name "*.backup" -o -name "*.bak" -o -name "*.old" | grep -v node_modules
```

**Similar CSS import confusion:**
```bash
# Look for multiple CSS imports that could conflict
grep -r "import.*\.css" src/ | wc -l
```

**Similar legacy syntax:**
```bash
# Check for other v3 → v4 migration artifacts
grep -r "@apply\|@variants\|@responsive" src/ || true
```

## Updated repo-health.sh (precision improvements)

**Key changes:**
1. CSS imports: Flag >1, not any
2. Reset detection: Match import statements, not comments  
3. Add backup file detection
4. Clearer success/warning messaging

## Durability strategy

**Prevent regression:**
- Invariant tests run in CI
- Pre-commit hook could run invariants (fast subset)
- Health script becomes early warning, not definitive

**Make fixes stick:**
- Document decisions in this file
- Link to specific tests that enforce invariants
- Create .gitignore entries to prevent re-accumulation

## Evidence of effectiveness

**Before fixes:**
- 3 red flags from health script
- Manual cleanup required after migrations
- Potential for CSS pipeline confusion

**After fixes:**
- Precise detection (fewer false positives)
- Automated prevention (invariant tests)
- Clear documentation of decisions

**Measurable success:**
- Health script shows only real issues
- CI fails if anti-patterns reintroduced  
- Team can trust automation signals

---

## Next actions (prioritized)

1. **Remove backup files** (immediate)
2. **Add invariant tests** (prevents regression)
3. **Update repo-health.sh** (reduces noise)
4. **Wire invariants to CI** (enforcement)
5. **Document decisions** (institutional memory)

This approach eliminates the **class** of "migration artifacts left behind" rather than just cleaning up this instance.
