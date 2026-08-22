import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const apple = path.join(root, "apple");
const dist = path.join(root, "dist-apple");
const project = path.join(dist, "MazenmiXTream-iPhone-iPad");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(project, { recursive: true });
for (const name of ["Package.swift", "project.yml", "README.md", "MazenmiXTreamCore", "MazenmiXTreamApp"]) {
  fs.cpSync(path.join(apple, name), path.join(project, name), { recursive: true });
}
execFileSync("zip", ["-qr", "MazenmiXTream-iPhone-iPad-Source.zip", "MazenmiXTream-iPhone-iPad"], { cwd: dist });
console.log(`Apple project ZIP created at ${path.relative(root, path.join(dist, "MazenmiXTream-iPhone-iPad-Source.zip"))}`);
