// Herdr draws images only from real folders, and this mod's folder may be a link to its git clone,
// so its own icons live here and are written to its data folder. An empty box stands in until they are.
import { div, svg } from "gpui-kit";
import { appHome } from "herdr";
import * as fs from "fs/promises";

const SVG = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  copy: SVG(`<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`),
  check: SVG(`<path d="M20 6 9 17l-5-5"/>`),
};

let ready = false, written = null;

// Resolves once the icons are on disk; redraw after that.
export function writeIcons() {
  written ??= (async () => {
    const folder = `${appHome()}/data/claude-session/icons`;
    await fs.mkdir(folder, { recursive: true });
    for (const [name, content] of Object.entries(ICONS)) await fs.writeFile(`${folder}/${name}.svg`, content);
    ready = true;
  })();
  return written;
}

export const icon = (name) => ready ? svg(`data/claude-session/icons/${name}.svg`) : div();
