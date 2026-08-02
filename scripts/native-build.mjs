import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { spawnSync } from "node:child_process";
import AdmZip from "adm-zip";

const root = process.cwd();
const cache = path.join(root, ".nitron-cache");
const androidJar = path.join(cache, "android", "android.jar");
const r8Jar = path.join(cache, "r8-8.8.34.jar");
const ecjJar = path.join(cache, "ecj-3.41.0.jar");
// Media3 1.8.x is the newest line that still supports Android 5.0 (API 21).
// Media3 1.9+ raises minSdk to 23, which would make the APK incompatible with
// some of the phones and TV boxes this app explicitly supports.
const media3Version = "1.8.1";
const media3Cache = path.join(cache, `media3-${media3Version}`);
const nativeOut = path.join(root, "build-native");
const classesOut = path.join(nativeOut, "classes");
const dexOut = path.join(nativeOut, "dex");
const source = path.join(root, "native", "com", "nicron", "webview", "MainActivity.java");

fs.mkdirSync(cache, { recursive: true });
fs.rmSync(nativeOut, { recursive: true, force: true });
fs.mkdirSync(classesOut, { recursive: true });
fs.mkdirSync(dexOut, { recursive: true });

if (!fs.existsSync(androidJar)) throw new Error("android.jar was not prepared by the first APK pass");
if (!fs.existsSync(r8Jar)) await download("https://dl.google.com/dl/android/maven2/com/android/tools/r8/8.8.34/r8-8.8.34.jar", r8Jar);
if (!fs.existsSync(ecjJar)) await download("https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/3.41.0/ecj-3.41.0.jar", ecjJar);

const media3Artifacts = [
  ...["common", "container", "database", "datasource", "decoder", "extractor", "exoplayer", "exoplayer-hls"].map((module) => ({
    name: `media3-${module}-${media3Version}`,
    type: "aar",
    url: `https://dl.google.com/dl/android/maven2/androidx/media3/media3-${module}/${media3Version}/media3-${module}-${media3Version}.aar`
  })),
  { name: "annotation-experimental-1.3.1", type: "aar", url: "https://dl.google.com/dl/android/maven2/androidx/annotation/annotation-experimental/1.3.1/annotation-experimental-1.3.1.aar" },
  { name: "exifinterface-1.3.6", type: "aar", url: "https://dl.google.com/dl/android/maven2/androidx/exifinterface/exifinterface/1.3.6/exifinterface-1.3.6.aar" },
  { name: "annotation-1.6.0", type: "jar", url: "https://dl.google.com/dl/android/maven2/androidx/annotation/annotation/1.6.0/annotation-1.6.0.jar" },
  { name: "kotlin-stdlib-2.0.20", type: "jar", url: "https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/2.0.20/kotlin-stdlib-2.0.20.jar" },
  { name: "jetbrains-annotations-13.0", type: "jar", url: "https://repo1.maven.org/maven2/org/jetbrains/annotations/13.0/annotations-13.0.jar" },
  { name: "guava-33.3.1-android", type: "jar", url: "https://repo1.maven.org/maven2/com/google/guava/guava/33.3.1-android/guava-33.3.1-android.jar" },
  { name: "failureaccess-1.0.2", type: "jar", url: "https://repo1.maven.org/maven2/com/google/guava/failureaccess/1.0.2/failureaccess-1.0.2.jar" }
];
fs.mkdirSync(media3Cache, { recursive: true });
const dependencyJars = [];
for (const artifact of media3Artifacts) {
  const archive = path.join(media3Cache, `${artifact.name}.${artifact.type}`);
  if (!fs.existsSync(archive)) await download(artifact.url, archive);
  if (artifact.type === "jar") {
    dependencyJars.push(archive);
    continue;
  }
  const classesJar = path.join(media3Cache, `${artifact.name}-classes.jar`);
  if (!fs.existsSync(classesJar)) {
    const aar = new AdmZip(archive);
    const entry = aar.getEntry("classes.jar");
    if (!entry) throw new Error(`${artifact.name} did not contain classes.jar`);
    fs.writeFileSync(classesJar, entry.getData());
  }
  dependencyJars.push(classesJar);
}

const compileClasspath = [androidJar, ...dependencyJars].join(path.delimiter);
run("java", ["-jar", ecjJar, "-1.8", "-encoding", "UTF-8", "-bootclasspath", androidJar, "-classpath", compileClasspath, "-d", classesOut, source]);
const classFiles = walk(classesOut).filter((file) => file.endsWith(".class"));
run("java", ["-cp", r8Jar, "com.android.tools.r8.D8", "--min-api", "21", "--lib", androidJar, "--output", dexOut, ...classFiles, ...dependencyJars]);

const dexFiles = fs.readdirSync(dexOut).filter((name) => /^classes\d*\.dex$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (!dexFiles.length) throw new Error("D8 did not create classes.dex");
const template = path.join(root, "node_modules", "nitron", "template", "base.apk");
const zip = new AdmZip(template);
for (const entry of zip.getEntries()) if (/^classes\d*\.dex$/.test(entry.entryName)) zip.deleteFile(entry.entryName);
for (const name of dexFiles) zip.addFile(name, fs.readFileSync(path.join(dexOut, name)));
zip.writeZip(template);
console.log(`Compiled persistent Media3 IPTV engine into ${dexFiles.length} DEX file(s).`);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) return download(response.headers.location, destination).then(resolve, reject);
      if (response.statusCode !== 200) return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}
