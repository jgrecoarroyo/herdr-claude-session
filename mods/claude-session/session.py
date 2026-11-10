#!/usr/bin/env python3
"""The Claude Code conversation running in a Herdr terminal, for the Session panel.

  session.py <terminal>[,<terminal>…] JSON for the first of them running Claude Code: terminal,
                                     session, context, limits, cost, prompts (oldest first)
  session.py <terminal> --exchange N writes prompt N and its replies as a page, prints the path

Which conversation: each Claude Code process has HC_TERMINAL_ID=<terminal> in its
environment and a ~/.claude/sessions/<pid>.json naming its session. Context and cost come
from the snapshot snapshot.py (the status line) saves after every reply
(~/.cache/claude-statusline/<session>.json). Prompts come from the transcript, read
only from where the last run stopped (it grows to many MB).
Reads local files only; sends nothing anywhere. What it keeps holds your conversation, so it
goes in ~/.cache/herdr-claude-session, readable only by you.
These files are Claude Code's own and undocumented: if its format changes, prompts can go missing.
"""
import json, os, re, subprocess, sys

HOME = os.path.expanduser("~")
CACHE = os.path.join(HOME, ".cache", "herdr-claude-session")
SNAPSHOTS = os.path.join(HOME, ".cache", "claude-statusline")
EXCHANGES = os.path.join(CACHE, "pages")
VERSION = 5


def terminals_of(pids):
    """Each process's HC_TERMINAL_ID (the Herdr terminal it runs in): /proc on Linux, else one ps for all."""
    found, rest = {}, []
    for pid in pids:
        try:
            with open(f"/proc/{pid}/environ", "rb") as f:
                env = f.read().decode(errors="replace").split("\0")
            found[pid] = next((v[len("HC_TERMINAL_ID="):] for v in env if v.startswith("HC_TERMINAL_ID=")), None)
        except OSError:
            rest.append(pid)
    if rest:
        out = subprocess.run(["ps", "eww", "-o", "pid=,command=", "-p", ",".join(map(str, rest))], capture_output=True, text=True).stdout
        for line in out.splitlines():
            pid, _, env = line.strip().partition(" ")
            m = re.search(r"\bHC_TERMINAL_ID=(\S+)", env)
            if pid.isdigit() and m:
                found[int(pid)] = m.group(1)
    return found


def session_for(terminals):
    """The first of these terminals that runs Claude Code, and its session."""
    found = sessions_by_terminal()
    for terminal in terminals:
        if terminal in found:
            return terminal, found[terminal]
    return None, None


def sessions_by_terminal():
    folder = os.path.join(HOME, ".claude", "sessions")
    infos = []
    for name in os.listdir(folder) if os.path.isdir(folder) else []:
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(folder, name), encoding="utf-8") as f:
                info = json.load(f)
            infos.append((int(info["pid"]), info))
        except Exception:
            continue
    where = terminals_of([pid for pid, _ in infos])
    best = {}
    for pid, info in infos:
        terminal = where.get(pid)
        if terminal and (terminal not in best or info.get("updatedAt", 0) > best[terminal].get("updatedAt", 0)):
            best[terminal] = info
    return best


def text_of(content):
    if isinstance(content, str):
        return content
    parts = []
    for block in content or []:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "\n".join(parts)


def clean(text):
    text = re.sub(r"<system-reminder>.*?</system-reminder>", "", text, flags=re.S)
    m = re.search(r"<command-name>(.*?)</command-name>", text, flags=re.S)
    if m:
        args = re.search(r"<command-args>(.*?)</command-args>", text, flags=re.S)
        return (m.group(1).strip() + " " + (args.group(1).strip() if args else "")).strip()
    text = re.sub(r"<pasted_content[^>]*>.*?</pasted_content[^>]*>", "[pasted text]", text, flags=re.S)
    return text.strip()


def local(iso, fmt="%H:%M"):
    try:
        from datetime import datetime
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime(fmt)
    except Exception:
        return (iso or "")[11:16]


def tool_line(block):
    """One short, human line for a tool call: its own description when it has one."""
    name, inp = block.get("name", "tool"), block.get("input") or {}
    base = lambda p: os.path.basename(str(p or "")) or "?"
    if inp.get("description") and name not in ("Agent", "Task"):
        return inp["description"]
    if name in ("Read", "Write", "Edit", "NotebookEdit"):
        return f"{name} {base(inp.get('file_path') or inp.get('notebook_path'))}"
    if name == "Bash":
        return (inp.get("command") or "").strip().splitlines()[0][:80] if inp.get("command") else "Ran a command"
    if name in ("Grep", "Glob"):
        return f"Search {inp.get('pattern', '')}"[:80]
    if name in ("Agent", "Task"):
        return f"Agent: {inp.get('description') or inp.get('subagent_type') or ''}".strip()
    if name == "AskUserQuestion":
        q = (inp.get("questions") or [{}])[0]
        return ("Asked you: " + (q.get("question") or q.get("header") or "a question"))[:120]
    if name in ("WebFetch", "WebSearch"):
        return f"{name} {inp.get('url') or inp.get('query') or ''}"[:80]
    return name


def read(path, sid):
    """Prompts and their turns, continuing from the cached position in the transcript."""
    os.makedirs(CACHE, exist_ok=True)
    cache = os.path.join(CACHE, sid + ".json")
    state = {"version": VERSION, "offset": 0, "prompts": [], "title": None, "compactions": 0, "recap": None}
    try:
        with open(cache, encoding="utf-8") as f:
            old = json.load(f)
        if old.get("version") == VERSION and old.get("offset", 0) <= os.path.getsize(path):
            state = old
    except Exception:
        pass
    prompts = state["prompts"]
    with open(path, "rb") as f:
        f.seek(state["offset"])
        for raw in f:
            if not raw.endswith(b"\n"):
                break  # a line still being written: read it next time
            state["offset"] += len(raw)
            try:
                d = json.loads(raw)
            except Exception:
                continue
            kind = d.get("type")
            if kind == "ai-title":
                state["title"] = d.get("aiTitle") or state["title"]
            elif kind == "system" and d.get("subtype") == "away_summary" and isinstance(d.get("content"), str):
                # Claude Code's own recap, written when you come back to the session after a while.
                state["recap"] = {"text": d["content"].strip(), "at": d.get("timestamp")}
            elif kind == "system" and d.get("subtype") == "compact_boundary":
                state["compactions"] += 1
            elif kind == "system" and d.get("subtype") == "turn_duration" and prompts:
                prompts[-1]["ms"] = d.get("durationMs")
                prompts[-1]["done"] = d.get("timestamp")
            elif kind == "user" and not d.get("isMeta") and (d.get("origin") or {}).get("kind") == "human" and not d.get("isSidechain"):
                content = d["message"]["content"]
                if isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
                    continue
                text = clean(text_of(content))
                if not text:
                    continue
                pos = d.get("turnPosition") or {}
                if prompts and pos.get("promptIndex") == prompts[-1]["n"]:
                    prompts[-1]["text"] += "\n\n" + text  # the same prompt, in more than one record
                    continue
                prompts.append({"n": pos.get("promptIndex") or len(prompts) + 1, "at": d.get("timestamp"),
                                "text": text, "ms": None, "done": None, "out": 0, "tools": 0, "steps": []})
            elif kind == "assistant" and prompts and not d.get("isSidechain"):
                msg = d.get("message") or {}
                p = prompts[-1]
                p["out"] += (msg.get("usage") or {}).get("output_tokens") or 0
                for block in msg.get("content") or []:
                    if not isinstance(block, dict):
                        continue
                    # In order: what Claude wrote and what it did, for the query page's timeline.
                    if block.get("type") == "tool_use":
                        p["tools"] += 1
                        p["steps"].append({"kind": "tool", "at": d.get("timestamp"), "text": tool_line(block)})
                    elif block.get("type") == "text" and block.get("text", "").strip():
                        p["steps"].append({"kind": "text", "at": d.get("timestamp"), "text": block["text"].strip()})
    with open(cache + ".tmp", "w", encoding="utf-8") as f:
        json.dump(state, f)
    os.replace(cache + ".tmp", cache)
    return state


def recap(state):
    """The latest recap, with how many queries were sent after it (so you can tell it's behind)."""
    r = state.get("recap")
    if not r:
        return None
    # Claude Code ends some with a hint about its own setting: not part of the recap.
    text = re.sub(r"\s*\(disable recaps in /config\)\s*$", "", r.get("text") or "")
    return r | {"text": text, "since": sum(1 for p in state["prompts"] if (p.get("at") or "") > (r.get("at") or ""))}


def transcript_path(info, snap):
    if snap.get("transcript_path") and os.path.exists(snap["transcript_path"]):
        return snap["transcript_path"]
    cwd = info.get("cwd", "")
    return os.path.join(HOME, ".claude", "projects", re.sub(r"[^A-Za-z0-9]", "-", cwd), info["sessionId"] + ".jsonl")


def main():
    os.umask(0o077)  # what this writes holds the conversation: only you can read it
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: session.py <terminal> [--exchange N]"}))
        return
    terminal, info = session_for([t for t in sys.argv[1].split(",") if t])
    if not info:
        print(json.dumps({"none": True}))
        return
    sid = info["sessionId"]
    try:
        with open(os.path.join(SNAPSHOTS, sid + ".json"), encoding="utf-8") as f:
            snap = json.load(f)
    except Exception:
        snap = {}
    path = transcript_path(info, snap)
    state = read(path, sid) if os.path.exists(path) else {"prompts": [], "title": None, "compactions": 0}

    if len(sys.argv) >= 4 and sys.argv[2] == "--exchange":
        n = int(sys.argv[3])
        p = next((x for x in state["prompts"] if x["n"] == n), None)
        if not p:
            print(json.dumps({"error": f"no prompt #{n}"}))
            return
        os.makedirs(EXCHANGES, exist_ok=True)
        out = os.path.join(EXCHANGES, f"{sid[:8]}-{n}.md")
        when = local(p["at"], "%Y-%m-%d %H:%M")
        meta = [when]
        if p["ms"]: meta.append(f"{round(p['ms'] / 1000)} s" if p["ms"] < 60000 else f"{round(p['ms'] / 60000)} min")
        if p["out"]: meta.append(f"{p['out']:,} tokens written")
        if p["tools"]: meta.append(f"{p['tools']} tool calls")
        steps = p["steps"]
        last = max((i for i, x in enumerate(steps) if x["kind"] == "text"), default=None)
        # The last thing Claude wrote is the answer (while it still works, the latest so far);
        # everything before it is the way there. "view: exchange" tells the viewer to draw it as a
        # query page (exchange.js in claude-query); any other app shows plain Markdown.
        out_lines = ["---", "view: exchange", "---", "", f"# Query #{n}", "", "_" + " · ".join(meta) + "_", "",
                     "\n".join("> " + line for line in p["text"].splitlines()), "", "## Along the way", ""]
        entry_open = False
        for x in steps[: last if last is not None else len(steps)]:
            if out_lines[-1] != "":
                out_lines.append("")
            if x["kind"] == "text":
                out_lines += [f"### ⏱ {local(x['at'])}", "", x["text"], ""]
                entry_open = True
            else:
                if not entry_open:
                    out_lines += [f"### ⏱ {local(x['at'])}", ""]
                    entry_open = True
                elif out_lines[-1] == "" and len(out_lines) > 1 and out_lines[-2].startswith("- ▸ "):
                    out_lines.pop()  # actions in a row stay one list
                out_lines.append("- ▸ " + x["text"].replace("\n", " "))
        out_lines += ["", "## Answer", "", steps[last]["text"] if last is not None else "_No answer yet._", ""]
        if last is not None and last < len(steps) - 1:
            out_lines += ["", "_Still working: " + ", ".join(x["text"] for x in steps[last + 1:] if x["kind"] == "tool")[:300] + "_", ""]
        with open(out, "w", encoding="utf-8") as f:
            f.write("\n".join(out_lines))
        print(json.dumps({"file": out}))
        return

    ctx = snap.get("context_window") or {}
    usage = ctx.get("current_usage") or {}
    used = sum(usage.get(k) or 0 for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
    cost = snap.get("cost") or {}
    print(json.dumps({
        "terminal": terminal,
        "session": {"id": sid, "name": info.get("name"), "title": state.get("title"), "cwd": info.get("cwd"),
                    "status": info.get("status"), "model": (snap.get("model") or {}).get("display_name"),
                    "version": snap.get("version") or info.get("version"), "effort": snap.get("effort")},
        "context": {"pct": ctx.get("used_percentage"), "size": ctx.get("context_window_size"), "used": used or None,
                    "compactions": state.get("compactions", 0)},
        "cost": {"usd": cost.get("total_cost_usd"), "added": cost.get("total_lines_added"), "removed": cost.get("total_lines_removed"),
                 "ms": cost.get("total_duration_ms")},
        "recap": recap(state),
        "snapshot": os.path.getmtime(os.path.join(SNAPSHOTS, sid + ".json")) if snap else None,
        "prompts": [{k: p[k] for k in ("n", "at", "ms", "done", "out", "tools")} | {"text": p["text"][:400]} for p in state["prompts"]],
    }))


if __name__ == "__main__":
    main()
