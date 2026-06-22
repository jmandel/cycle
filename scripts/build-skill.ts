/**
 * build-skill.ts (bun) — publish the agent skill inside the IG output.
 * Copies skill/ to input/images/skill/ (browsable on the published site) and
 * zips it to input/images/skill.zip (one-click download for agents/devs).
 * The IG Publisher copies input/images/** verbatim to output/.
 *
 * Run as part of:  bun scripts/build-all.ts
 */
const root = `${import.meta.dir}/..`;
const dest = `${root}/input/images/skill`;
const zip = `${root}/input/images/skill.zip`;

async function sh(cmd: string[]) {
  const p = Bun.spawn(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error(`${cmd.join(" ")} failed`);
}

await sh(["rm", "-rf", dest]);
await sh(["cp", "-r", `${root}/skill`, dest]);
await sh(["rm", "-f", zip]);
// zip from input/images so the archive's top entry is skill/
await sh(["sh", "-c", `cd ${root}/input/images && zip -rq skill.zip skill`]);
console.log("skill published -> input/images/skill/ (browsable) + input/images/skill.zip");
