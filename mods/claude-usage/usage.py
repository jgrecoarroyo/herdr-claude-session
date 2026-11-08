#!/usr/bin/env python3
"""Claude Code's limits for the Usage section: they're per account, so this takes the most recently
saved snapshot of any session (~/.cache/claude-statusline, saved by claude-session/snapshot.py).

A window that has already ended is adjusted, because the snapshot can't know yet: the 5-hour one
reads 0% and says when it reset; the weekly one reads 0% and moves on to its next week.
Prints JSON: {"five_hour": {...}, "seven_day": {...}}, or {} when there are no snapshots yet.
"""
import glob, json, os, time

WEEK = 7 * 86400
folder = os.path.expanduser("~/.cache/claude-statusline")
limits = {}
for path in sorted(glob.glob(os.path.join(folder, "*.json")), key=os.path.getmtime, reverse=True)[:5]:
    try:
        with open(path, encoding="utf-8") as f:
            limits = json.load(f).get("rate_limits") or {}
    except Exception:
        continue
    if limits:
        break

now = time.time()
five, week = limits.get("five_hour"), limits.get("seven_day")
if five and five.get("resets_at", now) <= now:
    five.update(used_percentage=0, past=True)
if week and week.get("resets_at", now) <= now:
    while week["resets_at"] <= now:
        week["resets_at"] += WEEK
    week["used_percentage"] = 0
print(json.dumps(limits))
