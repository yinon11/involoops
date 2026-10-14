#!/bin/sh
# Mirrors the upstream minio/minio image entrypoint contract: compose passes
# `command: server /data --console-address ":9001"` without the binary name,
# so a bare subcommand or flag gets the binary prefixed. Anything else
# (e.g. `docker run ... sh` for debugging) runs as given.
set -e

case "${1}" in
server | gateway | --* | -*)
	set -- minio "$@"
	;;
esac

exec "$@"
