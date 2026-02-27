#!/usr/bin/env bash
exec node --experimental-sqlite "$(dirname "$0")/../dist/cli.js" "$@"
