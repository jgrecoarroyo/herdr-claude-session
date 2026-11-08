// Usage: Claude Code's limits, per account, so not tied to the focused terminal (usage.py reads
// the newest snapshot of any session). Current is the 5-hour window, Weekly the 7-day one.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, settings, props, appHome } from "herdr";
import { folded, toggle, chevron } from "./accordion.js";

const DIR = () => `${appHome()}/mods/claude-usage`;
const COLORS = { seven_day: "#6cb6ff", hot: "#e5534b" };

const until = (epoch) => {
  const s = Math.max(0, epoch - Date.now() / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
// When a limit resets, on your clock: "13:09" today, else "Sat 14:00".
const at = (epoch) => {
  const d = new Date(epoch * 1000), now = new Date();
  return d.toDateString() === now.toDateString() ? hhmm(d) : `${DAYS[d.getDay()]} ${hhmm(d)}`;
};

export default class Usage extends View {
  init(_props, cx) {
    this.data = null;
    cx.timer.every(5000, (cx) => this.refresh(cx));
    cx.timer.every(60000, (cx) => cx.notify()); // "Resets in" counts down
    this.refresh(cx);
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", [`${DIR()}/usage.py`]);
        if (r.stdout !== this.raw) { this.raw = r.stdout; this.data = JSON.parse(r.stdout); cx.notify(); }
      } catch {}
      finally { this.loading = false; }
    });
  }

  palette() {
    const t = theme();
    // Bar tracks in the gray of a selected row in the sidebar (theme "raised").
    return { t, track: t.raised };
  }

  bar(pct, color, p) {
    const fill = Math.max(0, Math.min(100, pct ?? 0));
    return div().w_full().h(7).flex_none().rounded(4).bg(p.track).overflow_hidden()
      .child(div().h_full().w(`${fill}%`).min_w(fill > 0 ? 7 : 0).rounded(4).bg(fill >= 90 ? COLORS.hot : color));
  }

  // The week as 7 days, one segment each, from 7 days before the reset. Usage fills them in order;
  // today's has a bright outline. Spending evenly, the fill ends inside today: past it (amber),
  // you're ahead of an even share. The week runs reset to reset, e.g. Fri 19:00 → Fri 19:00, so a
  // segment spans two calendar days: the letters count from today, so today's is always right.
  weekBar(pct, resetsAt, color, p) {
    const t = p.t, start = resetsAt - 7 * 86400;
    const today = Math.min(6, Math.max(0, Math.floor((Date.now() / 1000 - start) / 86400)));
    const used = Math.max(0, Math.min(100, pct ?? 0)), per = 100 / 7;
    const segs = [...Array(7).keys()].map((i) => {
      const fill = Math.max(0, Math.min(1, (used - i * per) / per));
      const ahead = i > today;
      return v_flex().flex_1().min_w(0).gap(3).items_center()
        .child(div().w_full().h(10).rounded(3).bg(p.track).border_1().border_color(i === today ? t.foreground : p.track).overflow_hidden()
          .child(div().h_full().w(`${Math.round(fill * 100)}%`).bg(ahead ? "#e3b341" : used >= 90 ? COLORS.hot : color)))
        .child(div().text_size(9).text_color(i === today ? t.foreground : t.dim).child(DAYS[new Date(Date.now() + (i - today) * 86400000).getDay()].slice(0, 1)));
    });
    return h_flex().w_full().gap(3).children(segs);
  }

  // A limit: the label and percentage, the bar, "Resets in 3h 17m" with the clock time on the right.
  head(label, pct, p) {
    return h_flex().items_center().justify_between()
      .child(div().text_size(14).font_bold().text_color(p.t.foreground).child(label))
      .child(div().text_size(16).font_bold().text_color(p.t.foreground).child(pct == null ? "–" : `${pct}%`));
  }

  limit(id, lim, label, color, p, week = false) {
    const pct = lim.used_percentage;
    return v_flex().id(id).flex_none().gap(5).px(6)
      .child(this.head(label, pct, p))
      .child(week ? this.weekBar(pct, lim.resets_at, color, p) : this.bar(pct, color, p))
      .child(h_flex().justify_between().text_size(11.5).text_color(p.t.muted)
        .child(div().child(lim.past ? `Reset at ${at(lim.resets_at)}` : `Resets in ${until(lim.resets_at)}`))
        .child(div().text_color(p.t.dim).child(at(lim.resets_at))));
  }

  render(cx) {
    const p = this.palette(), t = p.t, d = this.data ?? {};
    const block = props()?.fold; // optional: this block's id in the layout, to fold it
    const header = h_flex().px(16).h(41).flex_none().items_center()
      .child(h_flex().id("usage-title").gap(5).items_center().text_size(11.5).font_medium().text_color(t.dim).child("Usage")
        .when(Boolean(block), (e) => e.cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click(() => toggle(block, 42)).child(chevron(block, t.dim))));
    const root = v_flex().id("usage").size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border)
      .text_color(t.foreground).text_size(12.5).child(header);
    if (block && folded(block)) return root;
    const five = d.five_hour, week = d.seven_day;
    return root.child(v_flex().flex_1().min_h(0).px(10).pt(6).pb(8).gap(12)
      .when(Boolean(five), (e) => e.child(this.limit("limit-5h", five, "Current", settings().dark !== false ? "#dbdbdb" : t.foreground, p)))
      .when(Boolean(week), (e) => e.child(this.limit("limit-week", week, "Weekly", COLORS.seven_day, p, true)))
      .when(!five && !week, (e) => e.child(div().px(6).text_size(11).text_color(t.dim).child("Limits show after Claude's next reply."))));
  }
}
