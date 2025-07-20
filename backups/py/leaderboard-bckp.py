import os
import requests
from ftplib import FTP
import io
import json
from datetime import datetime, timezone

# ENV settings
FTP_HOST        = os.environ["FTP_HOST"]
FTP_USER        = os.environ["FTP_USER"]
FTP_PASS        = os.environ["FTP_PASS"]
DISCORD_WEBHOOK = os.environ["DISCORD_WEBHOOK"]

LEADERBOARD_FILE = "leaderboard.json"
MESSAGE_ID_FILE  = "discord_message_id.txt"
TRACK            = "ks_nurburgring_layout_gp_a"
CAR              = "tatuusfa1"
TOP_N            = 10

def ms_to_min_sec(ms):
    sec = ms / 1000
    m = int(sec // 60)
    s = sec % 60
    return f"{m}:{s:06.3f}"

def truncate_name(name, max_len=14):
    return name if len(name) <= max_len else name[:max_len-3] + "..."

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
        return None  # bestand bestaat (nog) niet

def save_message_id(mid: str):
    ftp_upload_bytes(MESSAGE_ID_FILE, mid.encode())

def fetch_leaderboard():
    ftp_download(LEADERBOARD_FILE)
    with open(LEADERBOARD_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def build_embed(data, track, car):
    lb = data.get(track, {}).get(car, [])
    lb.sort(key=lambda e: e["laptime"])
    medals = {1: "🥇", 2: "🥈", 3: "🥉"}

    pos_list, driver_list, time_list = [], [], []
    for i, entry in enumerate(lb[:TOP_N], start=1):
        pos_list.append(medals.get(i, f"{i}."))
        driver_list.append(truncate_name(entry.get("name", "Unknown"), 14))
        time_list.append(ms_to_min_sec(entry.get("laptime", 0)))

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M (UTC)")
    embed = {
        "title": "🏆 KMR Leaderboard",
        "color": 0xFF0000,
        "description": f"**Track:** `{track}`\n**Car:** `{car}`",
        "fields": [
            {"name": "Pos", "value": "\n".join(pos_list) or "—", "inline": True},
            {"name": "Driver", "value": "\n".join(driver_list) or "—", "inline": True},
            {"name": "Time", "value": "\n".join(time_list) or "—", "inline": True},
        ],
        "footer": {"text": f"Last updated: {now} • Data by AC Elite Leaderboard"}
    }
    return embed

def post_new(payload):
    # ?wait=true => JSON response incl. message id
    r = requests.post(DISCORD_WEBHOOK + "?wait=true", json=payload, timeout=30)
    r.raise_for_status()
    return r.json()["id"]

def edit_existing(message_id, payload):
    r = requests.patch(f"{DISCORD_WEBHOOK}/messages/{message_id}", json=payload, timeout=30)
    if r.status_code == 404:
        return False
    r.raise_for_status()
    return True

# (Optioneel) delete + nieuw posten in plaats van editen:
def delete_message(message_id):
    requests.delete(f"{DISCORD_WEBHOOK}/messages/{message_id}", timeout=30)

def main():
    data = fetch_leaderboard()
    embed = build_embed(data, TRACK, CAR)
    payload = {"embeds": [embed]}

    message_id = get_saved_message_id()
    if message_id:
        if edit_existing(message_id, payload):
            print(f"Edited existing message {message_id}")
            return
        else:
            print("Stored message not found (404) – posting a new one.")

    # (Als je liever eerst delete: uncomment volgende twee regels)
    # if message_id:
    #     delete_message(message_id)

    new_id = post_new(payload)
    save_message_id(new_id)
    print(f"Posted new message {new_id}")

if __name__ == "__main__":
    main()
