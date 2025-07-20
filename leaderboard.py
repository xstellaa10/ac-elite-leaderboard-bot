import os
import requests
from ftplib import FTP
import json
from datetime import datetime, timezone

# SETTINGS (nu uit env vars i.p.v. hard‑coded)
FTP_HOST         = os.environ["FTP_HOST"]
FTP_USER         = os.environ["FTP_USER"]
FTP_PASS         = os.environ["FTP_PASS"]
DISCORD_WEBHOOK  = os.environ["DISCORD_WEBHOOK"]

LEADERBOARD_FILE = "leaderboard.json"
TRACK            = "ks_nurburgring_layout_gp_a"
CAR              = "tatuusfa1"
TOP_N            = 10

def ms_to_min_sec(ms):
    sec = ms/1000
    m   = int(sec // 60)
    s   = sec % 60
    return f"{m}:{s:06.3f}"

def truncate_name(name, max_len=14):
    return name if len(name) <= max_len else name[:max_len-3] + "..."

def fetch_leaderboard_via_ftp():
    ftp = FTP(FTP_HOST)
    ftp.login(FTP_USER, FTP_PASS)
    with open(LEADERBOARD_FILE, 'wb') as f:
        ftp.retrbinary(f"RETR {LEADERBOARD_FILE}", f.write)
    ftp.quit()
    with open(LEADERBOARD_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def post_leaderboard_columns(data, track, car, webhook_url):
    lb = data.get(track, {}).get(car, [])
    lb.sort(key=lambda e: e["laptime"])
    medals = {1: "🥇", 2: "🥈", 3: "🥉"}

    pos_list    = []
    driver_list = []
    time_list   = []

    for i, entry in enumerate(lb[:TOP_N], start=1):
        pos_list.append(medals.get(i, f"{i}."))
        driver_list.append(truncate_name(entry.get("name","Unknown"),14))
        time_list.append(ms_to_min_sec(entry.get("laptime",0)))

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M (UTC)")
    embed = {
        "title": "🏆 KMR Leaderboard",
        "color": 0xFF0000,
        "description": f"**Track:** `{track}`\n**Car:** `{car}`",
        "fields": [
            {"name": "Pos",    "value": "\n".join(pos_list),    "inline": True},
            {"name": "Driver", "value": "\n".join(driver_list), "inline": True},
            {"name": "Time",   "value": "\n".join(time_list),   "inline": True},
        ],
        "footer": {"text": f"Last updated: {now} • Data by AC Elite Leaderboard"}
    }

    resp = requests.post(webhook_url, json={"embeds":[embed]})
    if resp.status_code not in (200,204):
        print(f"Failed to post: {resp.status_code} {resp.text}")

if __name__ == "__main__":
    data = fetch_leaderboard_via_ftp()
    post_leaderboard_columns(data, TRACK, CAR, DISCORD_WEBHOOK)
