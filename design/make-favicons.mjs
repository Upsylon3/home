// make-favicons.mjs — builds every app's browser-tab icon and home-screen
// icons FROM the icon set in design/icons/, so they can never drift from it.
//
// WHEN TO RUN IT: only when an icon or the brand colors change:
//     node design/make-favicons.mjs && ./design/sync-assets.sh
// The generated files are committed (design/favicons/<app>/), so a normal
// checkout does not need this script or `sharp` to build anything.
//
// WHAT IT MAKES, per app:
//   favicon.svg          the icon in amber, transparent background (crisp at
//                        any size; modern browsers prefer it)
//   favicon.png          64x64 fallback for browsers without SVG favicons
//   apple-touch-icon.png 180x180, shown when saved to an iPhone home screen
//   icon-192.png / icon-512.png   Android / installed-web-app icons
// The PNGs sit on the warm-black page color with rounded corners, because a
// thin amber outline floating on a transparent square disappears on many
// home screens.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const AMBER = "#e0892b"; // --amber (dark theme) in design/tokens.css
const BG = "#17120e"; // --bg (dark theme)

const APPS = ["home", "homecloud", "homemedia", "homenotes", "homevault"];

for (const app of APPS) {
  // The icon files use stroke="currentColor" so they follow the theme;
  // a standalone image has no theme, so we paint the real color in.
  const icon = fs.readFileSync(`design/icons/${app}.svg`, "utf8").replaceAll("currentColor", AMBER);
  const out = `design/favicons/${app}`;
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(`${out}/favicon.svg`, icon);

  // Pull the icon's inner drawing out of its <svg> wrapper so we can place
  // it inside a bigger square (48-unit icon, scaled to 70% and centered).
  const inner = icon.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const tile = (size) => Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
       <rect width="100" height="100" rx="22" fill="${BG}"/>
       <g transform="translate(15 15) scale(1.4583)">${inner}</g>
     </svg>`
  );
  for (const [name, size] of [["favicon.png", 64], ["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
    await sharp(tile(size), { density: 300 }).resize(size, size).png().toFile(path.join(out, name));
  }
  console.log("made favicons for", app);
}
