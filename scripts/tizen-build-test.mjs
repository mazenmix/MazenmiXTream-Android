import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outputRoot = path.join(root, "dist-tizen");
const projectRoot = path.join(outputRoot, "MazenmiXTream-Samsung-Tizen");
const projectZip = path.join(outputRoot, "MazenmiXTream-Samsung-Tizen-Project.zip");

if (!fs.existsSync(projectZip)) {
  const build = spawnSync(process.execPath, [path.join(root, "scripts", "tizen-build.mjs")], { cwd: root, encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr || build.stdout);
}

for (const file of ["config.xml", "index.html", "platform.js", "style.css", "tizen.css", "icon.png", ".project", ".tproject", "vendor/client.js"]) {
  assert.ok(fs.existsSync(path.join(projectRoot, file)), `missing Tizen project file: ${file}`);
}

const config = fs.readFileSync(path.join(projectRoot, "config.xml"), "utf8");
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
assert.match(config, /tizen:profile name="tv-samsung"/);
assert.match(config, /privilege\/tv\.inputdevice/);
assert.match(config, /privilege\/internet/);
assert.match(html, /\$WEBAPIS\/webapis\/webapis\.js/);
assert.match(html, /tizen\.css/);
assert.ok(html.indexOf("platform.js") < html.indexOf("vendor/client.js"), "Samsung platform bridge must load before the application");
assert.match(fs.readFileSync(path.join(projectRoot, "vendor/client.js"), "utf8"), /10009/);

const archive = spawnSync("unzip", ["-Z1", projectZip], { encoding: "utf8" });
assert.equal(archive.status, 0, archive.stderr);
assert.match(archive.stdout, /config\.xml/);
assert.match(archive.stdout, /vendor\/client\.js/);
assert.doesNotMatch(archive.stdout, /native\/|MainActivity|package\.json/);

console.log("Samsung Tizen project build tests passed.");
