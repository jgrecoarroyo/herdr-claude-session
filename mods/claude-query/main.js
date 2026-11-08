// One query from the Session section, as a page in a pane beside the terminal: props.file is the
// first page. Session puts the next one in shared "claude-query.file" and sends "show", which only
// the copy on screen receives.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, nextCommand, props, readTextFile, shared, theme, window } from "herdr";
import { exchangeView } from "./exchange.js";

export default class ClaudeQuery extends View {
  init(_props, cx) {
    this.text = null; this.error = null; this.gen = 0;
    cx.spawn(async (cx) => {
      await this.load(props()?.file, cx);
      for (;;) {
        await nextCommand();
        await this.load(shared("claude-query.file"), cx);
      }
    });
  }

  async load(file, cx) {
    let text = null;
    try { text = file ? await readTextFile(file) : null; } catch {}
    this.text = text;
    this.error = text == null ? "This page is gone: click the query in Session again." : null;
    this.gen += 1; // new ids, so the text views start over and the page isn't mixed with the last
    cx.notify();
  }

  // Web links go to the browser; a link in a conversation is never opened as a local file.
  link(url) {
    if (/^https?:/i.test(url)) exec(window().platform === "macos" ? "open" : "xdg-open", [url]).catch(() => null);
  }

  render(cx) {
    const t = theme();
    const root = v_flex().id("claude-query").size_full().min_h(0).bg(t.background).text_color(t.foreground);
    if (this.error) return root.child(div().p(20).text_color(t.dim).child(this.error));
    if (this.text == null) return root.child(div().p(20).text_color(t.dim).child("Loading…"));
    return root.child(div().id("query-scroll").flex_1().min_h(0).overflow_y_scrollbar()
      .child(h_flex().w_full().justify_center()
        .child(v_flex().flex_1().min_w(0).max_w(860).overflow_hidden().px(28).py(24).text_size(14)
          .child(exchangeView(this.text, t, this.gen, (url) => this.link(url))))));
  }
}
