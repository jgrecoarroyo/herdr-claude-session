#!/usr/bin/env python3
"""Claude Code status line for the Session and Usage sections. Claude Code hands its status line
the session's context, cost and limits after every reply; this keeps the latest per session in
~/.cache/claude-statusline/<session>.json, readable only by you. It sends nothing anywhere.

  snapshot.py                 shows nothing
  snapshot.py "<command>"     also runs your own status line, with the same input, and shows its output
"""
import json, os, re, subprocess, sys


def save(raw):
    session = json.loads(raw).get("session_id")
    if not isinstance(session, str) or not re.fullmatch(r"[\w-]+", session):
        return
    os.umask(0o077)
    folder = os.path.join(os.path.expanduser("~"), ".cache", "claude-statusline")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, session + ".json")
    with open(path + ".tmp", "wb") as f:
        f.write(raw)
    os.replace(path + ".tmp", path)


raw = sys.stdin.buffer.read()
try:
    save(raw)
except Exception:
    pass  # a failed snapshot must not break the status line
if len(sys.argv) > 1:
    result = subprocess.run(sys.argv[1], shell=True, input=raw, stdout=subprocess.PIPE)
    sys.stdout.buffer.write(result.stdout)
