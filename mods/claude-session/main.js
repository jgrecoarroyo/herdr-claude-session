// Session: the Claude Code conversation in the focused terminal, in the sidebar under Agents.
//   - the conversation's title, then context, model and cost (the account's limits are in the Usage section);
//   - Claude Code's own recap (written when you come back to a session after a while), folding;
//   - every query you sent, newest first, folding: click one to read it with its reply in the
//     claude-query pane beside the terminal (Claude Code can't be scrolled from outside);
//   - Claude's live status word ("✻ Divining…") while it works.
// Data: session.py (the transcript + what snapshot.py, the status line, saves).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, focused, panes, spaces, exec, hc, run, theme, settings, props, shared, setShared, appHome, openOverlay } from "herdr";
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
const ago = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
// Which sections are open, per copy; the panel works the same if storage isn't there.
const remembered = (key) => { try { return localStorage.getItem(key) !== "closed"; } catch { return true; } };
const remember = (key, open) => { try { localStorage.setItem(key, open ? "open" : "closed"); } catch {} };
// What the panel shows, chosen in its ⋯ menu: shared, so the menu (a copy of this mod in a popup)
// and the panel agree, and kept across restarts.
const PARTS = [["title", "Title"], ["context", "Context"], ["recap", "Recap"], ["queries", "Queries"]];
const showing = (part) => (shared("claude-session.hide") ?? {})[part] !== true;
const flipPart = (part) => setShared("claude-session.hide", { ...(shared("claude-session.hide") ?? {}), [part]: showing(part) });
const clock = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export default class Session extends View {
  init(_props, cx) {
    if (props()?.menu) return; // the ⋯ menu: draws only the checkboxes
    this.terminal = null; this.live = null;
    this.seen = {}; // terminal -> what session.py said about it last ({ none: true }: no Claude Code there)
    this.open_ = { recap: remembered("recap"), queries: remembered("queries") };
    cx.timer.every(3000, (cx) => this.refresh(cx));
    // Focus moved: switch now rather than at the next refresh (no program runs for this check).
    cx.timer.every(300, (cx) => { if (this.target() !== this.terminal) this.refresh(cx); });
    cx.timer.every(1500, (cx) => this.watchStatus(cx));
    this.refresh(cx);
  }

  // The terminal to show: the focused one, whatever runs in it (session.py says whether it's Claude
  // Code; Herdr's agent list can miss one). With a pane that isn't a terminal focused (the query
  // pane beside it), the conversation shown last if it's in the focused space, else that space's
  // first Claude Code agent. Never another space's: it would pass for this one's.
  target() {
    const f = focused();
    if (!f) return null;
    if (f.terminal) return f.terminal.includes("/") ? null : f.terminal;
    const tabs = new Set((spaces().find((s) => s.id === f.space)?.tabs ?? []).map((c) => c.id));
    if (this.shown && panes().some((p) => p.terminal === this.shown && tabs.has(p.tab))) return this.shown;
    return agents().find((a) => a.app === "claude-code" && !a.address.includes("/") && a.space === f.space)?.address ?? null;
  }

  // Herdr's agent record for the conversation shown, if it lists one (its status).
  agent() {
    return this.terminal ? agents().find((a) => a.address === this.terminal) ?? null : null;
  }

  refresh(cx) {
    const terminal = this.target();
    if (terminal !== this.terminal) { this.terminal = terminal; this.live = null; cx.notify(); } // shows what's known of it at once
    if (!terminal || this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", [`${DIR()}/session.py`, terminal]);
        const d = JSON.parse(r.stdout);
        const changed = JSON.stringify(d) !== JSON.stringify(this.seen[terminal]);
        this.seen[terminal] = d; this.error = null;
        if (!d.none) this.shown = terminal;
        if (changed && terminal === this.terminal) cx.notify();
      } catch (e) { this.error = String(e?.message ?? e); cx.notify(); }
      finally {
        this.loading = false;
        if (this.target() !== terminal) this.refresh(cx); // focus moved while it ran
      }
    });
  }

  // Claude's spinner line: "✻ Divining… (2m 14s · ↓ 6.8k tokens)".
  watchStatus(cx) {
    // Read while Herdr says it works, or always for a Claude Code it doesn't list as an agent.
    const a = this.agent(), terminal = this.terminal;
    const d = terminal ? this.seen[terminal] : null;
    if (!d || d.none || (a && a.status !== "working")) { if (this.live) { this.live = null; cx.notify(); } return; }
    if (this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["read", terminal]);
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

  flip(key, cx) {
    this.open_[key] = !this.open_[key];
    remember(key, this.open_[key]);
    cx.notify();
  }

  // A folding heading inside the panel: chevron and label on the left, a note on the right.
  section(key, label, note, t) {
    return h_flex().id(`sec-${key}`).flex_none().pt(4).px(6).gap(5).items_center().cursor_pointer()
      .text_size(11).font_semibold().text_color(t.muted).hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => this.flip(key, cx))
      .child(svg(`mods/workspace-chrome/chevron-${this.open_[key] ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
      .child(div().flex_none().child(label))
      .child(div().flex_1().min_w(0).truncate().text_right().font_normal().text_color(t.dim).child(note));
  }

  // The ⋯ button at the right of the header: three dots, opening the menu just below it.
  dots(t) {
    const dot = () => div().size(3).flex_none().rounded(2).bg(t.dim);
    return h_flex().id("session-menu").w(24).h(22).flex_none().gap(2).items_center().justify_center().rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover)).tooltip("Show or hide parts")
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        const b = e.bounds;
        openOverlay({ mod: "claude-session", kind: "popup", width: 180, height: PARTS.length * 30 + 10, props: { menu: true },
          ...(b ? { at: { x: b.x + b.width - 180, y: b.y + b.height + 4 } } : {}) });
      })
      .child(dot()).child(dot()).child(dot());
  }

  // The menu itself: a checkbox per part; clicking one shows or hides it at once (the menu stays open).
  menu(t) {
    return v_flex().id("session-parts").w_full().p(5).gap(0).bg(t.popover).text_size(12.8).children(PARTS.map(([part, label]) => {
      const on = showing(part);
      return h_flex().id(`part-${part}`).h(30).px(8).gap(9).items_center().rounded(7).cursor_pointer().text_color(t.foreground)
        .hover((s) => s.bg(t.hover)).on_click(() => flipPart(part))
        .child(h_flex().size(15).flex_none().items_center().justify_center().rounded(4)
          .when(on, (e) => e.bg(t.accent).text_color(t.accent_foreground).child(svg("mods/workspace-chrome/check.svg").size(11)))
          .when(!on, (e) => e.border_1().border_color(t.input)))
        .child(div().child(label));
    }));
  }

  recapCard(recap, t) {
    const open = this.open_.recap, behind = recap.since >= 10;
    return h_flex().id("recap").flex_none().p(8).px(10).rounded(8).bg(t.raised)
      .child(v_flex().flex_1().min_w(0).gap(5)
        .child(h_flex().id("sec-recap").gap(5).items_center().cursor_pointer().text_size(11).text_color(t.dim)
          .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => this.flip("recap", cx))
          .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
          .child(div().flex_none().font_semibold().text_color(t.muted).child("Recap"))
          .child(div().flex_none().child(`· ${ago(recap.at)}`))
          .when(recap.since > 0, (e) => e.child(div().min_w(0).truncate().when(behind, (e) => e.text_color("#e8a04a"))
            .child(`· ${recap.since} ${recap.since === 1 ? "query" : "queries"} since`))))
        .when(open, (e) => e.child(div().text_size(12).line_height(1.45).text_color(t.muted).child(recap.text))));
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
    const p = this.palette(), t = p.t, d = this.terminal ? this.seen[this.terminal] : null, a = this.agent(), rail = (this.width ?? Infinity) < RAIL;
    const sized = (el) => el.on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } });
    // The same section header as Agents: a line above, "Session" in small dim type.
    const block = props()?.fold; // optional: this block's id in the layout, to fold it
    if (props()?.menu) return this.menu(t);
    const header = h_flex().px(rail ? 8 : 16).h(41).flex_none().items_center().justify_between()
      .child(h_flex().id("session-title").gap(5).items_center().text_size(11.5).font_medium().text_color(t.dim).child("Session")
        .when(Boolean(block), (e) => e.cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click(() => toggle(block, 42)).child(chevron(block, t.dim))))
      .when(!rail, (e) => e.child(this.dots(t)));
    const root = v_flex().id("session").size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .text_color(t.foreground).text_size(12.5).child(header);
    if (block && folded(block) && !rail) return root; // the rail has no title to unfold it with
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
    if (!this.terminal) return note("Focus a terminal running Claude Code.");
    if (!d) return note(this.error ?? "Reading the session…");
    if (d.none) return note("No Claude Code conversation in this terminal.");

    const ctx = d.context ?? {};
    const prompts = [...(d.prompts ?? [])].reverse();
    const working = a ? a.status === "working" : Boolean(this.live);
    const s = d.session ?? {};
    const title = s.title ?? s.name;
    const recap = d.recap;
    const meta = [s.model, ctx.size ? `${kfmt(ctx.used)} / ${kfmt(ctx.size)}` : null, d.cost?.usd != null ? `$${d.cost.usd.toFixed(2)}` : null,
      ctx.compactions ? `${ctx.compactions}× compacted` : null].filter(Boolean).join(" · ");

    const shown = Object.fromEntries(PARTS.map(([part]) => [part, showing(part)]));
    return root.child(body
      .when(shown.title || shown.context, (e) => e.child(v_flex().flex_none().gap(5).px(6)
        // The conversation's name heads the panel, wrapping rather than cut short.
        .when(Boolean(title) && shown.title, (e) => e.child(div().id("session-name").pb(8).text_size(15).font_semibold()
          .line_height(1.3).text_color(t.foreground).child(title)))
        .when(shown.context, (e) => e
          .child(this.head("Context", ctx.pct, p))
          .child(this.bar(ctx.pct, contextColor(ctx.pct ?? 0, t), p))
          .child(div().text_size(11).text_color(t.dim).truncate().child(meta)))))
      // Claude Code's recap, on a quiet card: in its top line
      // how old it is and how many queries came after it (amber when it's well behind).
      .when(Boolean(recap) && shown.recap, (e) => e.child(this.recapCard(recap, t)))
      .when(shown.queries, (e) => e.child(this.section("queries", "Queries", String(prompts.length), t)))
      .when(!(shown.queries && this.open_.queries), (e) => e.child(div().flex_1()))
      .when(shown.queries && this.open_.queries, (e) => e.child(v_flex().id("session-queries").flex_1().min_h(0).overflow_y_scrollbar().gap(1)
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
        }))))
      // Left-aligned and within the sidebar: the word stays whole, the detail shortens with "…".
      .child(h_flex().h(22).w_full().min_w(0).flex_none().px(6).gap(7).items_center().overflow_hidden().text_color("#e8a04a").text_size(12.5)
        .font_family(settings().font_family ?? "JetBrains Mono")
        .when(Boolean(this.live), (e) => e
          .child(div().w(12).flex_none().child("✻").frames(SPINNER, 120))
          .child(div().flex_none().child(this.live.word))
          .when(Boolean(this.live?.detail), (e) => e.child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(this.live.detail))))
        .when(!this.live, (e) => e.text_color(t.dim).text_size(11).child(a?.status === "blocked" ? "waiting for you" : "idle"))));
  }
}
