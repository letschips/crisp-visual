// Requires a running Obsidian with Crisp Visual loaded and its gallery open.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const args = [];
if (process.env.VISUAL_VAULT) args.push(`vault=${process.env.VISUAL_VAULT}`);
args.push('eval', `code=${fs.readFileSync(path.join(__dirname, 'license-gates.live.js'), 'utf8')}`);
const result = spawnSync('obsidian', args, { encoding: 'utf8', timeout: 30000 });
if (result.error || result.status !== 0 || !result.stdout.includes('=> ')) {
  throw result.error || new Error(result.stderr || result.stdout || 'Obsidian evaluation failed');
}
const report = JSON.parse(result.stdout.split('=> ', 2)[1].trim());
const output = process.env.VISUAL_REPORT || path.join(os.tmpdir(), `visual-license-gates-${Date.now()}.json`);
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: output, ...report }, null, 2));
process.exitCode = report.passed ? 0 : 1;
