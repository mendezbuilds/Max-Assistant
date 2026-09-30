import { spawn, execFile } from "node:child_process";
import path from "node:path";

/**
 * Starts/stops the `core` process from the dashboard's own server. Scoped
 * to exactly this one action — see the command route for the (small,
 * hardcoded) set of phrases that can reach it; this module has no general
 * "run a command" capability.
 *
 * No PID is tracked across calls (in a file, in memory, anywhere) — the
 * dashboard's dev server restarts independently of core's, which would
 * make any remembered PID stale. Instead, both "is it running" and "stop
 * it" work by matching `core`'s own dev script on the command line of
 * currently running processes — confirmed for real (spawned it, inspected
 * the actual resulting process tree, matched, and killed it) rather than
 * assumed: `tsx watch src/index.ts` (core's `package.json` "dev" script)
 * spawns as `cmd.exe /c "...tsx.cmd watch src/index.ts"`, which itself
 * spawns the real `node.exe` process actually running it — two processes,
 * not one, and the cmd.exe wrapper is not the one Node's own
 * `child_process.spawn` hands back a killable equivalent for on Windows,
 * so a match on the command line (which both processes carry, since the
 * child's is the parent's with the shell wrapper stripped) is what
 * reliably reaches both, not a single tracked PID.
 */
// Set in next.config.js, not computed here via __dirname — this file gets
// bundled into Next's own chunks, which makes a __dirname computed here
// resolve to the wrong place at runtime (same issue, same fix, as
// MAX_DB_FILE — see the comment on it in next.config.js).
function getRepoRoot(): string {
  const root = process.env.MAX_REPO_ROOT;
  if (!root) throw new Error("MAX_REPO_ROOT is not set (should be set by next.config.js)");
  return root;
}

const CORE_MATCH = "watch src/index.ts";

// execFile, not exec — exec() runs the whole command through cmd.exe's own
// string parser, which means correctly quoting a PowerShell script that
// itself contains quotes means getting cmd.exe's *and* PowerShell's quoting
// rules both right at once; found for real that this wasn't working
// (Stop-Process calls failed with no useful error message through that
// path). execFile with the script as its own argv element hands it to
// powershell.exe directly, with no shell in between to re-parse it, so
// none of that applies.
function runPowerShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("powershell", ["-NoProfile", "-Command", command], (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

// Name -eq 'node.exe' is doing real work here, not just belt-and-suspenders
// — found by hitting it for real, not by inspection: Node's child_process
// (both this module's own spawn() and exec()) runs commands through a
// cmd.exe wrapper on Windows, and that wrapper's own command line contains
// the *entire* inner command string verbatim, including this query's own
// "watch src/index.ts" text — so a plain command-line match unconditionally
// matched that wrapper process too and always reported "running", even
// with nothing real started. Excluding by $PID alone wasn't enough either:
// that only excludes the innermost powershell.exe, not its own cmd.exe
// parent, which carries the same embedded text. Requiring Name=node.exe
// sidesteps the whole problem — none of these wrapper processes are ever
// actually named that, no matter how many shells deep the text is repeated.
export async function isCoreProcessRunning(): Promise<boolean> {
  const out = await runPowerShell(
    `(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*${CORE_MATCH}*' } | Measure-Object).Count`
  );
  return parseInt(out.trim(), 10) > 0;
}

export async function startCore(): Promise<void> {
  const repoRoot = getRepoRoot();
  const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx.cmd");
  const coreDir = path.join(repoRoot, "apps", "core");
  const child = spawn(tsxBin, ["watch", "src/index.ts"], {
    cwd: coreDir,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: true, // .cmd shims on Windows throw EINVAL from spawn() without this — confirmed
  });
  child.unref();
}

export async function stopCore(): Promise<void> {
  // Same Name-based targeting as isCoreProcessRunning, extended to also
  // catch the cmd.exe wrapper spawn() creates alongside the real node.exe
  // (see startCore's own comment) — both named specifically enough
  // (node.exe; or cmd.exe actually running tsx.cmd) that this can never
  // match this command's own powershell.exe/cmd.exe execution wrapper,
  // however many shells deep Node's exec() nests it.
  await runPowerShell(
    `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*${CORE_MATCH}*') -or ($_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*tsx.cmd*${CORE_MATCH}*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  );
}
