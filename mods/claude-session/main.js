// Session: the Claude Code conversation in the focused terminal, in the sidebar under Agents.
//   - context, model and cost (the account's limits are in the Usage section);
//   - every query you sent, newest first: click one to read it with its reply in the
//     claude-query pane beside the terminal (Claude Code can't be scrolled from outside);
//   - Claude's live status word ("✻ Divining…") while it works.
// Data: session.py (the transcript + what snapshot.py, the status line, saves).
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, focused, panes, exec, hc, run, theme, settings, props, setShared, appHome } from "herdr";
import { folded, toggle, chevron } from "./accordion.js";

const DIR = () => `${appHome()}/mods/claude-session`;
const RUNNING = "#d97757";
const RAIL = 160; // px: narrower than this, the sidebar is collapsed
// The context bar: white, then orange from "warn"%, then red from "danger"%. A layout can change
// them with the prop "context": { "warn": 50, "danger": 80 }.
const contextColor = (pct, t) => {
  const { warn = 50, danger = 80 } = props()?.context ?? {};
  if (pct >= danger) return "#e5484d";
  if (pct >= warn) return "#f0883e";
  return settings().dark !== false ? "#dbdbdb" : t.foreground;
};
const SPINNER = ["✻", "✶", "✳", "✢", "·", "✢", "✳", "✶"];

const kfmt = (n) => n == null ? "–" : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
const dur = (ms) => {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
};
const clock = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export default class Session extends View {
  init(_props, cx) {
    this.terminal = null; this.data = null; this.live = null;
    cx.timer.every(3000, (cx) => this.refresh(cx));
    cx.timer.every(1500, (cx) => this.watchStatus(cx));
    this.refresh(cx);
  }

  // The Claude Code agent in the focused terminal, else the one followed last,
  // else any in the focused space.
  agent() {
    const all = agents().filter((a) => a.app === "claude-code" && !a.address.includes("/"));
    const f = focused();
    return all.find((a) => a.address === f?.terminal) ?? all.find((a) => a.address === this.terminal)
      ?? all.find((a) => a.space === f?.space) ?? null;
  }

  refresh(cx) {
    const a = this.agent();
    if (!a) { if (this.data) { this.data = null; this.terminal = null; cx.notify(); } return; }
    if (a.address !== this.terminal) { this.terminal = a.address; this.data = null; this.live = null; }
    if (this.loading) return;
    this.loading = true;
    const terminal = a.address;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", [`${DIR()}/session.py`, terminal]);
        const d = JSON.parse(r.stdout);
        if (terminal !== this.terminal) return;
        const changed = JSON.stringify(d) !== this.raw;
        this.raw = JSON.stringify(d); this.data = d; this.error = null;
        if (changed) cx.notify();
      } catch (e) { this.error = String(e?.message ?? e); cx.notify(); }
      finally { this.loading = false; }
    });
  }

  // Claude's spinner line: "✻ Divining… (2m 14s · ↓ 6.8k tokens)".
  watchStatus(cx) {
    const a = this.agent();
    if (!a || a.status !== "working") { if (this.live) { this.live = null; cx.notify(); } return; }
    if (this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["read", a.address]);
        const m = /^\s*[✻✶✳✢·✽*]\s+([^\s(]+…)\s*(?:\(([^)]*)\))?/m.exec(r.stdout ?? "");
        // Keep the elapsed time and tokens ("19s · ↓ 2.1k tokens"), not phrases like "still thinking…".
        const keep = (part) => /^\d+[hms]\b|^\d+m \d+s|↓|↑|tokens/.test(part.trim());
        const live = m ? { word: m[1], detail: (m[2] ?? "").split("·").filter(keep).map((x) => x.trim()).join(" · ") } : null;
        if (JSON.stringify(live) !== JSON.stringify(this.live)) { this.live = live; cx.notify(); }
      } catch {}
      finally { this.reading = false; }
    });
  }

  open(n, cx) {
    const terminal = this.terminal;
    this.selected = { terminal, n }; // the open one stays highlighted, like the running one
    cx.notify();
    cx.spawn(async () => {
      try {
        const r = await exec("python3", [`${DIR()}/session.py`, terminal, "--exchange", String(n)]);
        const { file } = JSON.parse(r.stdout);
        if (!file) return;
        // The query pane in this tab takes it, else a new one opens on the right.
        setShared("claude-query.file", file);
        const tab = focused()?.tab;
        if (panes().some((p) => p.mod === "claude-query" && p.tab === tab)) run("claude-query.show");
        else run("pane.split", { direction: "right", mod: "claude-query", props: { file } });
      } catch {}
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
      .child(div().h_full().w(`${fill}%`).min_w(fill > 0 ? 7 : 0).rounded(4).bg(color));
  }

  // The label on the left, the percentage on the right (as in the Usage section).
  head(label, pct, p) {
    return h_flex().items_center().justify_between()
      .child(div().text_size(14).font_bold().text_color(p.t.foreground).child(label))
      .child(div().text_size(16).font_bold().text_color(p.t.foreground).child(pct == null ? "–" : `${pct}%`));
  }

  // The collapsed sidebar: a bar of five segments (each 20%), the number, and its label, stacked. Details are in the tooltip.
  railGauge(id, label, pct, color, tip, p) {
    const fill = Math.max(0, Math.min(100, pct ?? 0));
    return v_flex().id(id).w_full().flex_none().items_center().gap(5).tooltip(tip)
      .child(h_flex().gap(1).flex_none().children([0, 1, 2, 3, 4].map((i) => div().w(5).h(4).flex_none().rounded(1)
        .bg(i < Math.ceil(fill / 20) ? (fill >= 90 ? "#e5484d" : color) : p.track))))
      .child(v_flex().items_center()
        .child(div().text_size(13).line_height(1.15).font_bold().text_color(p.t.foreground).child(pct == null ? "–" : `${pct}%`))
        .child(div().text_size(11).line_height(1.15).text_color(p.t.muted).child(label)));
  }

  render(cx) {
    const p = this.palette(), t = p.t, d = this.data, a = this.agent(), rail = (this.width ?? Infinity) < RAIL;
    const sized = (el) => el.on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } });
    // The same section header as Agents: a line above, "Session" in small dim type.
    const block = props()?.fold; // optional: this block's id in the layout, to fold it
    const header = h_flex().px(rail ? 8 : 16).h(41).flex_none().items_center()
      .child(h_flex().id("session-title").gap(5).items_center().text_size(11.5).font_medium().text_color(t.dim).child("Session")
        .when(Boolean(block), (e) => e.cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click(() => toggle(block, 42)).child(chevron(block, t.dim))));
    const root = v_flex().id("session").size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .text_color(t.foreground).text_size(12.5).child(header);
    if (block && folded(block)) return root;
    if (rail) {
      const ctx = d?.context ?? {}, count = d?.prompts?.length;
      const tip = [d?.session?.model, ctx.size ? `${kfmt(ctx.used)} / ${kfmt(ctx.size)}` : null, d?.cost?.usd != null ? `$${d.cost.usd.toFixed(2)}` : null].filter(Boolean).join(" · ") || "No Claude Code session here";
      // No title here: at this width there's no room for it, and the labels say what each one is.
      return sized(v_flex().id("session").size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_color(t.foreground)).child(v_flex().flex_1().min_h(0).pt(12).gap(20)
        .child(this.railGauge("rail-context", "ctx", ctx.pct, contextColor(ctx.pct ?? 0, t), tip, p))
        .when(count != null, (e) => e.child(v_flex().id("rail-queries").items_center().tooltip(`${count} ${count === 1 ? "query" : "queries"}`)
          .child(div().text_size(13).line_height(1.15).text_color(t.foreground).child(String(count)))
          .child(div().text_size(11).line_height(1.15).text_color(t.muted).child("qs"))))
        .child(div().flex_1())
        .child(h_flex().id("rail-status").h(22).flex_none().justify_center().items_center().text_color("#e8a04a").text_size(13)
          .tooltip(this.live ? `${this.live.word}${this.live.detail ? ` ${this.live.detail}` : ""}` : a?.status === "blocked" ? "Waiting for you" : "Idle")
          .font_family(settings().font_family ?? "JetBrains Mono")
          .when(Boolean(this.live), (e) => e.child(div().child("✻").frames(SPINNER, 120)))
          .when(!this.live && a?.status === "blocked", (e) => e.child(div().child("!")))
          .when(!this.live && a?.status !== "blocked", (e) => e.child(div().text_color(t.dim).child("·")))));
    }
    // 10 px sides: the query rows reach out to it (their own 6 px pad puts their text at 16 px),
    // everything else adds 6 px more (inset()) to sit at 16 px too.
    const body = v_flex().flex_1().min_h(0).px(10).pt(6).pb(8).gap(12);
    const inset = (el) => el.px(6);
    const note = (text) => root.child(body.child(inset(div().text_size(12).text_color(t.dim).child(text))));
    if (!a) return note("Focus a terminal running Claude Code.");
    if (!d) return note(this.error ?? "Reading the session…");
    if (d.none) return note("No Claude Code session found in this terminal.");

    const ctx = d.context ?? {};
    const prompts = [...(d.prompts ?? [])].reverse();
    const working = a.status === "working";
    const s = d.session ?? {};
    const meta = [s.model, ctx.size ? `${kfmt(ctx.used)} / ${kfmt(ctx.size)}` : null, d.cost?.usd != null ? `$${d.cost.usd.toFixed(2)}` : null,
      ctx.compactions ? `${ctx.compactions}× compacted` : null].filter(Boolean).join(" · ");

    return root.child(body
      .child(v_flex().flex_none().gap(5).px(6)
        .child(this.head("Context", ctx.pct, p))
        .child(this.bar(ctx.pct, contextColor(ctx.pct ?? 0, t), p))
        .child(div().text_size(11).text_color(t.dim).truncate().child(meta)))
      .child(h_flex().flex_none().pt(4).px(6).items_center().justify_between().text_size(11).font_semibold().text_color(t.muted)
        .child(div().child("Queries")).child(div().font_normal().text_color(t.dim).child(String(prompts.length))))
      .child(v_flex().id("session-queries").flex_1().min_h(0).overflow_y_scrollbar().gap(1)
        .children(prompts.map((q, i) => {
          const running = i === 0 && working && q.ms == null;
          const on = running || (this.selected?.terminal === this.terminal && this.selected?.n === q.n);
          // On the left "working" while it runs, then the time it was sent; duration, tokens and
          // tools on the right.
          const stats = [q.ms != null ? dur(q.ms) : null, q.out ? `↓${kfmt(q.out)}` : null, q.tools ? `${q.tools} tool${q.tools === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
          // As the style lab: rounded rows, 5/6 px padding, tight lines; hover and the running one
          // in the selected-row gray.
          return h_flex().id(`q-${q.n}`).flex_none().px(6).py(5).gap(7).items_start().rounded(7).cursor_pointer().line_height(1.25)
            .when(on, (e) => e.bg(t.raised)).hover((s) => s.bg(t.raised)).on_click((_e, cx) => this.open(q.n, cx))
            .child(v_flex().flex_1().min_w(0).gap(2)
              .child(div().text_size(12).line_height(1.25).truncate().child(q.text.split("\n")[0]))
              .child(h_flex().gap(8).justify_between().text_size(10.5).line_height(1.25).text_color(on ? RUNNING : t.dim)
                .child(div().flex_none().child(running ? "working" : clock(q.at)))
                .child(div().min_w(0).truncate().child(stats))));
        })))
      // Left-aligned and within the sidebar: the word stays whole, the detail shortens with "…".
      .child(h_flex().h(22).w_full().min_w(0).flex_none().px(6).gap(7).items_center().overflow_hidden().text_color("#e8a04a").text_size(12.5)
        .font_family(settings().font_family ?? "JetBrains Mono")
        .when(Boolean(this.live), (e) => e
          .child(div().w(12).flex_none().child("✻").frames(SPINNER, 120))
          .child(div().flex_none().child(this.live.word))
          .when(Boolean(this.live?.detail), (e) => e.child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(this.live.detail))))
        .when(!this.live, (e) => e.text_color(t.dim).text_size(11).child(a.status === "blocked" ? "waiting for you" : "idle"))));
  }
}
