// Query pages from the Session section, drawn as a timeline in the mono font: the query in a
// card, the comments and actions on the way, then the answer. The page stays plain Markdown, so
// any other app can show it too; this only reads its fixed shape:
//   # Query #N / _meta_ / > query / ## Along the way / ### ⏱ HH:MM entries / ## Answer
import { div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { settings } from "herdr";

const CLAY = "#d97757";

// A comment without its Markdown marks (bold, code ticks, links), for plain dim text.
const plain = (md) => md.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^#+\s*/gm, "").trim();

function parse(text) {
  const b = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  const along = b.indexOf("\n## Along the way\n"), answerAt = b.indexOf("\n## Answer\n", Math.max(0, along));
  const head = b.slice(0, along < 0 ? (answerAt < 0 ? b.length : answerAt) : along);
  const title = /^# (.+)$/m.exec(head)?.[1] ?? "Query";
  const meta = /^_(.+)_$/m.exec(head)?.[1] ?? "";
  const query = head.split("\n").filter((l) => l.startsWith(">")).map((l) => l.replace(/^> ?/, "")).join("\n");
  const middle = along < 0 ? "" : b.slice(along + 18, answerAt < 0 ? b.length : answerAt);
  const entries = middle.split(/^### ⏱ /m).slice(1).map((chunk) => {
    const [time, ...rest] = chunk.split("\n");
    const tools = rest.filter((l) => l.startsWith("- ▸ ")).map((l) => l.slice(4));
    const comment = rest.filter((l) => !l.startsWith("- ▸ ")).join("\n").trim();
    return { time: time.trim(), comment, tools };
  });
  const answer = answerAt < 0 ? "" : b.slice(answerAt + 11).trim();
  return { title, meta, query, entries, answer };
}

export function exchangeView(text, t, gen, onLink) {
  const { title, meta, query, entries, answer } = parse(text);
  const mono = settings().font_family ?? "JetBrains Mono";
  const md = (id, src) => TextView.markdown(`${id}-${gen}`, src).selectable(true).on_link_click((url, cx) => onLink(url, cx));
  const label = (name) => h_flex().items_center().gap(10).flex_none()
    .child(div().text_size(10.5).font_semibold().text_color(t.dim).child(name))
    .child(div().flex_1().h(1).bg(t.border));

  return v_flex().w_full().gap(18).font_family(mono).text_size(13)
    // The query: a card with an accent edge, like the timeline's start.
    .child(v_flex().flex_none().rounded(8).bg(t.raised).border_l(3).border_color(CLAY).px(14).py(10).gap(6)
      .child(h_flex().gap(10).items_center()
        .child(div().flex_none().font_semibold().text_color(CLAY).child(title.replace(/^Query /, "")))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(meta)))
      .child(div().text_size(13.5).text_color(t.foreground).child(md("q", query || "_(empty)_"))))
    // The way there: each comment small and dim with its time, the actions under it.
    .when(entries.length > 0, (e) => e
      .child(label("ALONG THE WAY"))
      .child(v_flex().flex_none().ml(4).pl(14).border_l(2).border_color(t.border).gap(12)
        .children(entries.map((x, i) => h_flex().items_start().gap(10)
          .child(div().w(40).flex_none().pt(1).text_size(11).text_color(t.dim).child(x.time))
          .child(v_flex().flex_1().min_w(0).gap(4)
            // Plain dim text: TextView keeps its own colors, and comments are short sentences.
            .when(Boolean(x.comment), (e) => e.child(div().text_size(12.5).text_color(t.muted).child(plain(x.comment))))
            .children(x.tools.map((tool) => h_flex().gap(6).text_size(11.5).text_color(t.dim)
              .child(div().flex_none().text_color(CLAY).child("▸"))
              .child(div().flex_1().min_w(0).truncate().child(tool)))))))))
    // The answer, full size.
    .child(label("ANSWER"))
    .child(div().text_size(13.5).text_color(t.foreground).child(md("a", answer || "_No answer yet._")));
}
