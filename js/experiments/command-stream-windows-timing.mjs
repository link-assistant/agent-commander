// Diagnose why test/command-stream.test.mjs sometimes exceeds its 10 s budget
// under Deno on windows-latest (it passes in 2-3 s on the other runs).
//
// Usage (from js/):
//   deno run -A experiments/command-stream-windows-timing.mjs [iterations]
//   node experiments/command-stream-windows-timing.mjs [iterations]
//
// For each iteration it times three ways of running the same `node -e` probe:
//   raw-node  child_process.spawn('node', ...)            (no shell)
//   raw-shell child_process.spawn(<command-stream shell>, ['-c', ...])
//   $         command-stream's $ template, as the test does
// and records when 'spawn', 'exit' and 'close' fire, so a slow start can be
// told apart from a child whose pipes never close. Every run is bounded by a
// 60 s watchdog so a hang cannot stall the job.
import cp from 'node:child_process';
import { $ } from 'command-stream';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const iterations = Number(process.argv[2] || globalThis.Deno?.args?.[0] || 6);
const runtime = globalThis.Deno ? 'deno' : globalThis.Bun ? 'bun' : 'node';
const show = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
const WATCHDOG_MS = 60_000;

function timeSpawn(cmd, args) {
  return new Promise((resolve) => {
    const start = performance.now();
    const marks = {};
    const mark = (name) => {
      marks[name] ??= Math.round(performance.now() - start);
    };
    const child = cp.spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d) => {
      mark('firstStdout');
      stdout += d;
    });
    child.stdout.on('end', () => mark('stdoutEnd'));
    child.stderr.on('end', () => mark('stderrEnd'));
    child.on('spawn', () => mark('spawn'));
    child.on('exit', () => mark('exit'));
    const watchdog = setTimeout(() => {
      mark('watchdog');
      child.kill();
      resolve({ marks, stdout, hung: true });
    }, WATCHDOG_MS);
    child.on('close', (code) => {
      mark('close');
      clearTimeout(watchdog);
      resolve({ marks, stdout, code, hung: false });
    });
    child.on('error', (error) => {
      clearTimeout(watchdog);
      resolve({ marks, error: String(error), hung: false });
    });
  });
}

async function timeDollar() {
  const start = performance.now();
  let watchdog;
  const result = await Promise.race([
    $`node -e ${show} -- -p ${"it's"}`.quiet(),
    new Promise((resolve) => {
      watchdog = setTimeout(() => resolve({ hung: true }), WATCHDOG_MS);
    }),
  ]);
  clearTimeout(watchdog);
  return {
    ms: Math.round(performance.now() - start),
    hung: !!result.hung,
    code: result.code,
    stdout: result.stdout && String(result.stdout),
  };
}

// The first shell command-stream's findAvailableShell() picks on each OS.
const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
const shell =
  process.platform === 'win32'
    ? { cmd: fs.existsSync(gitBash) ? gitBash : 'bash.exe', args: ['-c'] }
    : { cmd: '/bin/sh', args: ['-l', '-c'] };
console.log(JSON.stringify({ runtime, platform: process.platform, shell }));

for (let i = 0; i < iterations; i++) {
  const rawNode = await timeSpawn('node', ['-e', show, '--', 'x']);
  const rawShell = await timeSpawn(shell.cmd, [
    ...shell.args,
    `node -e '${show}' -- x`,
  ]);
  const dollar = await timeDollar();
  console.log(
    JSON.stringify({
      i,
      rawNode: rawNode.marks,
      rawShell: rawShell.marks,
      dollar,
    })
  );
}
// command-stream may keep handles open; do not let that hold the job.
process.exit(0);
