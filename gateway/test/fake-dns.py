#!/usr/bin/env python3
"""A tiny DNS server for testing the gateway, standing in for Docker's DNS.

Usage: fake-dns.py <port> <records-file>

The records file has one "name ip" pair per line. It is re-read on EVERY query,
so a test can make an app's name appear or vanish while nginx is running, which
is what happens when a container starts or stops. Names that aren't listed get
"no such name" (NXDOMAIN), like Docker's DNS does for a stopped container.
Only IPv4 (A) lookups are answered; that is all the gateway asks for.
"""
import socket
import struct
import sys


def read_records(path):
    records = {}
    try:
        for line in open(path):
            parts = line.split()
            if len(parts) == 2:
                records[parts[0].lower()] = parts[1]
    except FileNotFoundError:
        pass
    return records


def parse_question(data):
    """Return (name, qtype, end_offset_of_question)."""
    labels, i = [], 12
    while data[i] != 0:
        length = data[i]
        labels.append(data[i + 1 : i + 1 + length].decode())
        i += 1 + length
    qtype = struct.unpack(">H", data[i + 1 : i + 3])[0]
    return ".".join(labels).lower(), qtype, i + 5


def main():
    port, records_path = int(sys.argv[1]), sys.argv[2]
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", port))
    while True:
        data, addr = sock.recvfrom(512)
        try:
            name, qtype, end = parse_question(data)
        except Exception:
            continue
        ip = read_records(records_path).get(name)
        header_id = data[:2]
        question = data[12:end]
        if ip and qtype == 1:  # A record found
            answer = b"\xc0\x0c" + struct.pack(">HHIH", 1, 1, 2, 4) + socket.inet_aton(ip)
            response = header_id + struct.pack(">HHHHH", 0x8180, 1, 1, 0, 0) + question + answer
        elif ip:  # name exists, but not for this record type (e.g. AAAA): empty answer
            response = header_id + struct.pack(">HHHHH", 0x8180, 1, 0, 0, 0) + question
        else:  # no such name
            response = header_id + struct.pack(">HHHHH", 0x8183, 1, 0, 0, 0) + question
        sock.sendto(response, addr)


main()
