// Optional folding, on when the layout gives this block the prop "fold": "<its block id>".
// Shared "sidebar.sections" = { <block id>: { folded, weight } }:
// folding sets the block to its header's height, unfolding gives back the size it had.
import { svg } from "gpui-kit";
import { layout, run, shared, setShared } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export const folded = (id) => Boolean(shared("sidebar.sections")?.[id]?.folded);

export function toggle(id, headerPx) {
  const all = { ...(shared("sidebar.sections") ?? {}) };
  if (all[id]?.folded) {
    run("layout.resize", all[id].px != null ? { id, px: all[id].px } : { id, weight: all[id].weight ?? 1 });
    all[id] = { folded: false };
  } else {
    const size = find(layout(), id)?.size;
    all[id] = size?.px != null ? { folded: true, px: size.px } : { folded: true, weight: size?.weight ?? 1 };
    run("layout.resize", { id, px: headerPx });
  }
  setShared("sidebar.sections", all);
}

export const chevron = (id, color) =>
  svg(`mods/workspace-chrome/chevron-${folded(id) ? "right" : "down"}.svg`).size(12).flex_none().text_color(color);
