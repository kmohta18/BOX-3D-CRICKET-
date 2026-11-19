#!/usr/bin/env python3
"""
Box Cricket 3D - Zero-Dependency Static HTTP + WebSocket Relay Server (server.py)
Usage:
    python3 server.py --port 8080

Features:
- Serves plain ES modules (index.html, controller.html, src/main.js, physics.js, etc.)
- Implements RFC 6455 WebSocket upgrade and frame relay on /ws using pure Python 3 stdlib
- Relays 60-100 Hz gyroscope/accelerometer packets by 4-letter room code
- Provides /api/info returning local LAN IP so the QR code pairs phones over Wi-Fi automatically
"""

import argparse
import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import socket
import struct
from urllib.parse import parse_qs, urlparse

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

# Active WebSocket clients grouped by 4-letter room code: { room_code: set(writer) }
ROOMS = {}
CLIENT_META = {}


def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def encode_ws_frame(text_payload: str) -> bytes:
    data = text_payload.encode("utf-8")
    length = len(data)
    header = bytearray([0x81])  # FIN + Text frame
    if length < 126:
        header.append(length)
    elif length < 65536:
        header.append(126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(127)
        header.extend(struct.pack("!Q", length))
    return bytes(header) + data


async def read_ws_frame(reader: asyncio.StreamReader):
    first2 = await reader.readexactly(2)
    b1, b2 = first2[0], first2[1]
    opcode = b1 & 0x0F
    masked = (b2 & 0x80) != 0
    payload_len = b2 & 0x7F

    if payload_len == 126:
        ext = await reader.readexactly(2)
        payload_len = struct.unpack("!H", ext)[0]
    elif payload_len == 127:
        ext = await reader.readexactly(8)
        payload_len = struct.unpack("!Q", ext)[0]

    if payload_len > 16384:
        return None

    mask_key = await reader.readexactly(4) if masked else b""
    payload = bytearray(await reader.readexactly(payload_len))
    if masked:
        for i in range(payload_len):
            payload[i] ^= mask_key[i % 4]

    if opcode == 0x8:  # Close frame
        return None
    if opcode == 0x9:  # Ping
        return "__PING__"
    return payload.decode("utf-8", errors="ignore")


async def broadcast_to_room(room: str, sender_writer, raw_text: str):
    peers = ROOMS.get(room, set()).copy()
    frame = encode_ws_frame(raw_text)
    for w in peers:
        if w is sender_writer:
            continue
        try:
            w.write(frame)
            await w.drain()
        except Exception:
            ROOMS.get(room, set()).discard(w)


async def handle_websocket(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, headers: dict, query: dict):
    key = headers.get("sec-websocket-key", "")
    accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode("utf-8")).digest()).decode("utf-8")
    handshake = (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
    )
    writer.write(handshake.encode("utf-8"))
    await writer.drain()

    room = (query.get("room", ["CRIC"])[0] or "CRIC").upper()[:4]
    role = query.get("role", ["controller"])[0]
    slot = query.get("slot", ["p1"])[0]

    ROOMS.setdefault(room, set()).add(writer)
    CLIENT_META[writer] = {"room": room, "role": role, "slot": slot}

    try:
        while True:
            msg_text = await read_ws_frame(reader)
            if msg_text is None:
                break
            if msg_text == "__PING__":
                continue
            try:
                parsed = json.loads(msg_text)
                if "room" in parsed and parsed["room"]:
                    new_room = str(parsed["room"]).upper()[:4]
                    if new_room != room:
                        ROOMS.get(room, set()).discard(writer)
                        room = new_room
                        ROOMS.setdefault(room, set()).add(writer)
                        CLIENT_META[writer]["room"] = room
            except Exception:
                pass
            await broadcast_to_room(room, writer, msg_text)
    except Exception:
        pass
    finally:
        ROOMS.get(room, set()).discard(writer)
        meta = CLIENT_META.pop(writer, None)
        if meta and meta.get("role") == "controller":
            disconnect_notice = json.dumps({
                "type": "controller_disconnect",
                "room": room,
                "slot": meta.get("slot", "p1")
            })
            await broadcast_to_room(room, writer, disconnect_notice)
        try:
            writer.close()
        except Exception:
            pass


async def handle_http_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, port: int):
    try:
        request_line = await reader.readline()
        if not request_line:
            writer.close()
            return
        parts = request_line.decode("utf-8", errors="ignore").strip().split(" ")
        if len(parts) < 2:
            writer.close()
            return
        method, raw_target = parts[0], parts[1]

        headers = {}
        while True:
            line = await reader.readline()
            if not line or line == b"\r\n":
                break
            decoded = line.decode("utf-8", errors="ignore").strip()
            if ":" in decoded:
                k, v = decoded.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        parsed_url = urlparse(raw_target)
        path = parsed_url.path
        query = parse_qs(parsed_url.query)

        # Check WebSocket Upgrade
        if headers.get("upgrade", "").lower() == "websocket":
            await handle_websocket(reader, writer, headers, query)
            return

        # API info endpoint for LAN IP QR code pairing
        if path == "/api/info":
            lan_ip = get_lan_ip()
            body = json.dumps({
                "ip": lan_ip,
                "port": port,
                "url": f"http://{lan_ip}:{port}"
            }).encode("utf-8")
            resp = (
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: application/json; charset=utf-8\r\n"
                f"Content-Length: {len(body)}\r\n"
                "Cache-Control: no-cache\r\n"
                "Connection: close\r\n\r\n"
            ).encode("utf-8") + body
            writer.write(resp)
            await writer.drain()
            writer.close()
            return

        # Serve static files (map /c short route to controller.html)
        rel_path = path.lstrip("/") or "index.html"
        if rel_path == "c":
            rel_path = "controller.html"
        blocked_files = {"server.py", "server.ts", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"}
        if rel_path in blocked_files or rel_path.startswith("."):
            writer.write(
                b"HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: 9\r\nConnection: close\r\n\r\nForbidden"
            )
            await writer.drain()
            writer.close()
            return
        safe_path = os.path.normpath(os.path.join(ROOT_DIR, rel_path))
        if not safe_path.startswith(ROOT_DIR) or not os.path.isfile(safe_path):
            not_found = b"404 Not Found"
            writer.write(
                b"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 13\r\nConnection: close\r\n\r\n"
                + not_found
            )
            await writer.drain()
            writer.close()
            return

        ext = os.path.splitext(safe_path)[1].lower()
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".mjs": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml"
        }.get(ext) or mimetypes.guess_type(safe_path)[0] or "application/octet-stream"

        with open(safe_path, "rb") as f:
            data = f.read()

        resp_header = (
            "HTTP/1.1 200 OK\r\n"
            f"Content-Type: {content_type}\r\n"
            f"Content-Length: {len(data)}\r\n"
            "Cache-Control: no-cache\r\n"
            "Connection: close\r\n\r\n"
        ).encode("utf-8")
        writer.write(resp_header + data)
        await writer.drain()
        writer.close()
    except Exception:
        try:
            writer.close()
        except Exception:
            pass


async def main():
    parser = argparse.ArgumentParser(description="Box Cricket 3D Server")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default: 8080)")
    args = parser.parse_args()

    lan_ip = get_lan_ip()
    server = await asyncio.start_server(
        lambda r, w: handle_http_client(r, w, args.port),
        host="0.0.0.0",
        port=args.port
    )
    print(f"Box Cricket 3D running on:")
    print(f"  Local:   http://localhost:{args.port}")
    print(f"  Network: http://{lan_ip}:{args.port} (Scan QR code on screen with phone)")
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
