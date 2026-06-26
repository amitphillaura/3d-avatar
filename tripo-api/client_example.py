#!/usr/bin/env python3
"""Minimal client: send an image, save the returned mesh.

  python client_example.py photo.png out.glb
  python client_example.py photo.png out.obj --format obj --url http://lenovo:8000

Over Tailscale, point --url at the MagicDNS name of the Lenovo, e.g.
  --url http://lenovo.tailnet-name.ts.net:8000
"""
import argparse
import sys
import urllib.request
import uuid

import urllib.error


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("out")
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    ap.add_argument("--format", default="glb", choices=["glb", "obj"])
    ap.add_argument("--mc-resolution", type=int, default=256)
    ap.add_argument("--api-key", default=None)
    args = ap.parse_args()

    with open(args.image, "rb") as fh:
        img = fh.read()

    boundary = uuid.uuid4().hex
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="upload"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + img + f"\r\n--{boundary}--\r\n".encode()

    url = f"{args.url}/generate?format={args.format}&mc_resolution={args.mc_resolution}"
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    if args.api_key:
        req.add_header("X-API-Key", args.api_key)

    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            data = resp.read()
            secs = resp.headers.get("X-Generation-Seconds", "?")
            device = resp.headers.get("X-Device", "?")
    except urllib.error.HTTPError as exc:
        print(f"error {exc.code}: {exc.read().decode(errors='replace')}", file=sys.stderr)
        return 1

    with open(args.out, "wb") as fh:
        fh.write(data)
    print(f"saved {args.out} ({len(data)} bytes) in {secs}s on {device}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
