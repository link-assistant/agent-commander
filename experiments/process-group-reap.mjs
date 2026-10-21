// Inspect what remains of a killed process group (zombies vs live processes).
import { startCommand, isProcessGroupAlive } from "../js/src/executor.mjs";
import { execSync } from "node:child_process";
const handle = await startCommand("(sleep 30 &); echo done", {
  attached: false,
  pipeDrainMs: 200,
});
await handle.waitForExit();
const pid = handle.process.pid;
for (let i = 0; i < 5; i++) {
  console.log(
    i,
    isProcessGroupAlive(pid),
    execSync(`ps -o pid,ppid,pgid,stat,cmd -g ${pid} || true`)
      .toString()
      .trim(),
  );
  await new Promise((r) => setTimeout(r, 300));
}
console.log("pid1", execSync("ps -o pid,cmd -p 1").toString());
