import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const root = process.cwd();
const outputRoot = path.join(root, "dist-tizen");
const projectRoot = path.join(outputRoot, "MazenmiXTream-Samsung-Tizen");
const projectZip = path.join(outputRoot, "MazenmiXTream-Samsung-Tizen-Project.zip");

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(projectRoot, "vendor"), { recursive: true });

function copy(source, destination) {
  const target = path.join(projectRoot, destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, source), target);
}

for (const name of ["style.css", "THIRD_PARTY_NOTICES.md"]) copy(name, name);
for (const name of ["polyfills.js", "brand.js", "hls.min.js", "mpegts.js"]) copy(`vendor/${name}`, `vendor/${name}`);
for (const name of ["config.xml", ".project", ".tproject", "tizen.css", "README.md"]) copy(`tizen/${name}`, name);
copy("assets/icon.png", "icon.png");

let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
html = html.replace(
  "  <title>MazenmiXTream</title>",
  "  <title>MazenmiXTream</title>\n  <script type=\"text/javascript\" src=\"$WEBAPIS/webapis/webapis.js\"></script>"
);
html = html.replace(
  "  <link rel=\"stylesheet\" href=\"style.css\">",
  "  <link rel=\"stylesheet\" href=\"style.css\">\n  <link rel=\"stylesheet\" href=\"tizen.css\">"
);
html = html.replace(
  "  <script src=\"vendor/client.js\"></script>",
  "  <script src=\"platform.js\"></script>\n  <script src=\"vendor/client.js\"></script>"
);
html = html.replace("v1.1.6 • MX Media3 Fast-Zap", "v1.1.6 • Samsung Tizen AVPlay");
html = html.replace("MX MEDIA3 LIVE", "MX SAMSUNG AVPLAY");
html = html.replace("Persistent stream engine active", "Hardware-accelerated Samsung TV stream engine");
fs.writeFileSync(path.join(projectRoot, "index.html"), html);

await build({
  entryPoints: [path.join(root, "main.js")],
  outfile: path.join(projectRoot, "vendor", "client.js"),
  bundle: false,
  minify: true,
  legalComments: "none",
  target: ["chrome56"]
});

await build({
  entryPoints: [path.join(root, "tizen", "platform.js")],
  outfile: path.join(projectRoot, "platform.js"),
  bundle: false,
  minify: false,
  legalComments: "none",
  target: ["chrome56"]
});

const zip = spawnSync("zip", ["-q", "-r", projectZip, "."], {
  cwd: projectRoot,
  encoding: "utf8"
});
if (zip.status !== 0) throw new Error(zip.stderr || "Could not create the Samsung Tizen project archive");

console.log(`Samsung Tizen project: ${projectRoot}`);
console.log(`Importable project ZIP: ${projectZip}`);
console.log("A Samsung TV certificate profile is required in Tizen Studio to create the installable signed WGT.");
