// Poll GitHub Actions check-runs for a commit until all conclude.
// Usage: node e2e/watch-ci.mjs <sha> [maxPolls]
const sha = process.argv[2] ?? '41f8b908';
const maxPolls = Number(process.argv[3] ?? 30);
const repo = '2140wtf/2140wtf';

const status = (c) => `${c.status} ${c.conclusion ?? '-'} ${c.name}`;

for (let i = 1; i <= maxPolls; i++) {
  const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': '2140wtf-agent' },
  });
  const body = await res.json().catch(() => ({}));
  const runs = body.check_runs ?? [];
  const ts = new Date().toLocaleTimeString();
  console.log(`--- poll ${i} (${ts}) ---`);
  if (runs.length === 0) {
    console.log('no check runs yet');
  } else {
    for (const r of runs) console.log(status(r));
  }
  const open = runs.filter((r) => r.status === 'in_progress' || r.status === 'queued' || r.status === 'pending');
  if (open.length === 0 && runs.length > 0) {
    const failed = runs.filter((r) => (r.conclusion ?? '') !== 'success');
    console.log(failed.length === 0 ? 'ALL GREEN ✅' : `FAILURES: ${failed.map((r) => r.name).join(', ')} ❌`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 20000));
}
console.log('timed out waiting for checks');
process.exit(1);