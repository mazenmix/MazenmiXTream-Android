import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { build } from "esbuild";

const root = process.cwd();
const nitronCli = path.join(root, "node_modules", "nitron", "dist", "cli.js");
const vendorDir = path.join(root, "vendor");
const assetsDir = path.join(root, "assets");
const hamzaVariant = process.env.MX_VARIANT === "hamza";
const publicBrand = hamzaVariant ? "Hamza" : "Mazenmi";
const publicName = `${publicBrand}XTream`;
fs.mkdirSync(vendorDir, { recursive: true });
fs.mkdirSync(assetsDir, { recursive: true });

fs.copyFileSync(path.join(root, "node_modules", "hls.js", "dist", "hls.min.js"), path.join(vendorDir, "hls.min.js"));
fs.copyFileSync(path.join(root, "node_modules", "mpegts.js", "dist", "mpegts.js"), path.join(vendorDir, "mpegts.js"));
fs.writeFileSync(path.join(vendorDir, "polyfills.js"), [
  fs.readFileSync(path.join(root, "node_modules", "core-js-bundle", "minified.js"), "utf8"),
  fs.readFileSync(path.join(root, "node_modules", "url-search-params-polyfill", "index.js"), "utf8"),
  fs.readFileSync(path.join(root, "node_modules", "whatwg-fetch", "dist", "fetch.umd.js"), "utf8")
].join("\n"));
fs.writeFileSync(path.join(vendorDir, "brand.js"), `(function(){var b=${JSON.stringify(publicBrand)},n=${JSON.stringify(publicName)};document.title=n;window.MX_PUBLIC_NAME=n;var nodes=document.querySelectorAll('.brand');for(var i=0;i<nodes.length;i++)nodes[i].innerHTML=b+'<span>XTream</span>';})();\n`);
await build({ entryPoints: [path.join(root, "main.js")], outfile: path.join(vendorDir, "client.js"), bundle: false, minify: true, legalComments: "none", target: ["chrome63"] });

await sharp(path.join(assetsDir, "icon.svg")).resize(1024, 1024).png().toFile(path.join(assetsDir, "icon.png"));
await sharp(path.join(assetsDir, "icon.svg")).resize(320, 180, { fit: "contain", background: "#08090c" }).png().toFile(path.join(assetsDir, "tv-banner.png"));

let cli = fs.readFileSync(nitronCli, "utf8");
const touchFeature = '    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />\n';
const leanbackFeature = '    <uses-feature android:name="android.software.leanback" android:required="false" />\n';
const bannerAttribute = '        android:banner="@drawable/tv_banner"\n';
const drawableMkdir = '    await mkdir4(join4(resDir, "drawable-nodpi"), { recursive: true });\n';
const bannerWrite = '      await sharp(join4(projectDir, "assets", "tv-banner.png")).toFile(join4(resDir, "drawable-nodpi", "tv_banner.png"));\n';
const leanbackBlock = '            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />\n            </intent-filter>\n';
cli = cli.split(touchFeature).join("").split(leanbackFeature).join("").split(bannerAttribute).join("").split(drawableMkdir).join("").split(bannerWrite).join("").split(leanbackBlock).join("");
cli = cli.replace(
  '  "Thumbs.db"\n]);',
  '  "Thumbs.db",\n  ".nitron-cache",\n  "build-native",\n  "native",\n  "scripts",\n  "assets",\n  "main.js"\n]);'
);
if (!cli.includes('  "main.js"')) cli = cli.replace('  "assets"\n]);', '  "assets",\n  "main.js"\n]);');
const extraExcludes = [
  "upload", "pids", "README.md", "THIRD_PARTY_NOTICES.md",
  "MazenmiXTream-v1.0-Universal.apk", "MazenmiXTream-v1.0-Source.zip",
  "MazenmiXTream-v1.0.2-Universal.apk", "MazenmiXTream-v1.0.2-Source.zip",
  "MazenmiXTream-v1.0.3-MX.apk", "MazenmiXTream-v1.0.3-MX-Source.zip",
  "MazenmiXTream-v1.0.4-MX.apk", "MazenmiXTream-v1.0.4-MX-Source.zip",
  "MazenmiXTream-v1.1.0-MX.apk", "MazenmiXTream-v1.1.0-MX-Source.zip",
  "MazenmiXTream-v1.1.1-MX.apk", "MazenmiXTream-v1.1.1-MX-Source.zip",
  "MazenmiXTream-v1.1.2-MX.apk", "MazenmiXTream-v1.1.2-MX-Source.zip",
  "MazenmiXTream-v1.1.3-MX.apk", "MazenmiXTream-v1.1.3-MX-Source.zip",
  "MazenmiXTream-v1.1.4-MX.apk", "MazenmiXTream-v1.1.4-MX-Source.zip",
  "MazenmiXTream-v1.1.5-MX.apk", "MazenmiXTream-v1.1.5-MX-Source.zip",
  "HamzaXTream-v1.1.5-MX.apk",
  "MazenmiXTream-v1.1.6-MX.apk", "MazenmiXTream-v1.1.6-MX-Source.zip",
  "HamzaXTream-v1.1.6-MX.apk"
];
const excludedStart = cli.indexOf("var EXCLUDED");
const excludedEnd = cli.indexOf("]);", excludedStart);
if (excludedStart >= 0 && excludedEnd > excludedStart) {
  let block = cli.slice(excludedStart, excludedEnd);
  for (const name of extraExcludes) {
    if (!block.includes(`  "${name}"`)) block = block.replace(/\n$/, `,\n  "${name}"\n`);
  }
  cli = cli.slice(0, excludedStart) + block + cli.slice(excludedEnd);
}
cli = cli.replaceAll('const cacheDir = join4(homedir(), ".nitron", "android");', 'const cacheDir = join4(process.cwd(), ".nitron-cache", "android");');
cli = cli.replace(
  '    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />',
  '    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />\n' + touchFeature.trimEnd() + '\n' + leanbackFeature.trimEnd()
);
cli = cli.replace(
  '        android:roundIcon="@mipmap/ic_launcher"\n        android:hardwareAccelerated="true"',
  '        android:roundIcon="@mipmap/ic_launcher"\n        android:banner="@drawable/tv_banner"\n        android:hardwareAccelerated="true"'
);
cli = cli.replace(
  '            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>',
  '            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>\n            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />\n            </intent-filter>'
);
cli = cli.replace(
  '    await mkdir4(join4(resDir, "values"), { recursive: true });',
  '    await mkdir4(join4(resDir, "values"), { recursive: true });\n    await mkdir4(join4(resDir, "drawable-nodpi"), { recursive: true });'
);
cli = cli.replace(
  '      for (const { dpi, size } of mipmaps) {',
  '      await sharp(join4(projectDir, "assets", "tv-banner.png")).toFile(join4(resDir, "drawable-nodpi", "tv_banner.png"));\n      for (const { dpi, size } of mipmaps) {'
);
fs.writeFileSync(nitronCli, cli);
console.log("Prepared player engines, adaptive icons and Android TV resources.");
