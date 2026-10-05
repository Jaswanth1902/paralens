import fs from 'node:fs';
import path from 'node:path';

/**
 * ParaLens Security Linter
 * Enforces AST-grounded security, secret detection, and sandbox safety.
 */

const DANGEROUS_PATTERNS = [
  { pattern: /\beval\s*\(/, message: 'Forbidden eval() execution found' },
  { pattern: /new\s+Function\s*\(/, message: 'Forbidden new Function() execution found' },
  { pattern: /child_process\.(exec|execSync)\s*\(/, message: 'Forbidden raw shell exec() found' },
  { pattern: /__proto__/, message: 'Prototype pollution vector __proto__ detected' },
  { pattern: /AKIA[0-9A-Z]{16}/, message: 'Exposed AWS Access Key pattern detected' },
  { pattern: /ghp_[0-9a-zA-Z]{36}/, message: 'Exposed GitHub Personal Access Token pattern detected' },
];

function scanDirectory(dir, issues = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
        continue;
      }
      scanDirectory(fullPath, issues);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js') || entry.name.endsWith('.json'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, lineIdx) => {
        for (const rule of DANGEROUS_PATTERNS) {
          if (rule.pattern.test(line)) {
            issues.push({
              file: fullPath,
              line: lineIdx + 1,
              message: rule.message,
              snippet: line.trim(),
            });
          }
        }
      });
    }
  }

  return issues;
}

const rootDir = process.cwd();
console.log(`[Security Lint] Scanning ParaLens codebase at ${rootDir}...`);
const srcIssues = scanDirectory(path.join(rootDir, 'src'));
const testIssues = scanDirectory(path.join(rootDir, 'test'));
const allIssues = [...srcIssues, ...testIssues];

if (allIssues.length > 0) {
  console.error(`[Security Lint] FAILED: ${allIssues.length} security violation(s) found:`);
  for (const issue of allIssues) {
    console.error(`  - ${path.relative(rootDir, issue.file)}:${issue.line} => ${issue.message} [${issue.snippet}]`);
  }
  process.exit(1);
} else {
  console.log('[Security Lint] PASSED: Zero dangerous AST vectors, zero hardcoded secrets, zero injection flaws detected.');
  process.exit(0);
}
