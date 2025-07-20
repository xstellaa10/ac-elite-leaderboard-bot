import os
import requests
from ftplib import FTP
import io
import json
from datetime import datetime, timezone

# ENV settings
FTP_HOST         = os.getenv("FTP_HOST", "de2.assettohosting.com")
FTP_USER         = os.getenv("FTP_USER", "40283-elite")
FTP_PASS         = os.getenv("FTP_PASS", "40283-elite")
DISCORD_WEBHOOK  = os.getenv("DISCORD_WEBHOOK", "https://discord.com/api/webhooks/1396509680855154899/NVpOnwrAuwYX2g1DlRjuGbjZI0uh_-fFRuhPS-vcD2h34_D67j6EnxZIDVURD4SOwCj_")

LEADERBOARD_FILE = "leaderboard.json"
MESSAGE_ID_FILE  = "discord_message_id.txt"
TRACK            = "ks_nurburgring_layout_gp_a"
CAR              = "tatuusfa1"
TOP_N            = 10

def ms_to_min_sec(ms):
    sec = ms / 1000.0
    m = int(sec // 60)
    s = sec % 60
    return f"{m}:{s:06.3f}"

def truncate_name(name, max_len=14):
    return name if len(name) <= max_len else name[: max_len - 3] + "..."

def ftp_download(filename):
    with FTP(FTP_HOST, FTP_USER, FTP_PASS) as ftp, open(filename, "wb") as f:
        ftp.retrbinary(f"RETR {filename}", f.write)

def ftp_upload_bytes(filename, data: bytes):
    with FTP(FTP_HOST, FTP_USER, FTP_PASS) as ftp:
        ftp.storbinary(f"STOR {filename}", io.BytesIO(data))

def get_saved_message_id():
    try:
        with FTP(FTP_HOST, FTP_USER, FTP_PASS) as ftp:
            buf = io.BytesIO()
            ftp.retrbinary(f"RETR {MESSAGE_ID_FILE}", buf.write)
        return buf.getvalue().decode().strip()
    except Exception:
        return None

def save_message_id(mid: str):
    ftp_upload_bytes(MESSAGE_ID_FILE, mid.encode())


def fetch_leaderboard():
    ftp_download(LEADERBOARD_FILE)
    with open(LEADERBOARD_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def build_embed(data, track, car):
    lb = data.get(track, {}).get(car, [])
    lb.sort(key=lambda e: e.get("laptime", float('inf')))
    medals = {1: "🥇", 2: "🥈", 3: "🥉"}

    now_iso = datetime.now(timezone.utc).isoformat()

    header = (
        f"__**Track:**__ `{track}`\n"
        f"__**Car:**__ `{car}`\n\n"
        f"**Top {TOP_N}:**\n"
    )

    lines = []
    for i, entry in enumerate(lb[:TOP_N], start=1):
        name = truncate_name(entry.get("name", "Unknown"))
        time = ms_to_min_sec(entry.get("laptime", 0))
        medal = medals.get(i, "")
        lines.append(f"{i}. **{name}** {medal} — `{time}`")

    description = header + "\n".join(lines)

    embed = {
        "author": {"name": "🏆 KMR Leaderboard"},
        "title": "AC Elite Server",
        "url": "https://acstuff.ru/s/q:race/online/join?httpPort=18283&ip=157.90.3.32",
        "color": 0xE67E22,
        "timestamp": now_iso,
        "description": description,
        "footer": {"text": "Data by AC Elite Leaderboard"},
    }
    return embed

def post_new(payload):
    resp = requests.post(f"{DISCORD_WEBHOOK}?wait=true", json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json().get("id")

def edit_existing(message_id, payload):
    resp = requests.patch(f"{DISCORD_WEBHOOK}/messages/{message_id}", json=payload, timeout=30)
    if resp.status_code == 404:
        return False
    resp.raise_for_status()
    return True

def main():
    data = fetch_leaderboard()
    embed = build_embed(data, TRACK, CAR)
    payload = {"embeds": [embed]}

    message_id = get_saved_message_id()
    if message_id and edit_existing(message_id, payload):
        print(f"✅ Edited message {message_id}")
    else:
        new_id = post_new(payload)
        if new_id:
            save_message_id(new_id)
            print(f"✅ Posted new message {new_id}")
        else:
            print("❌ Failed to obtain new message ID from Discord.")

if __name__ == "__main__":
    main()