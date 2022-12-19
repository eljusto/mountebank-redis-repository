#!/bin/sh

rm -f /tmp/podman.sock
ssh -i ~/.ssh/podman-machine-default -p $(podman system connection list --format=json | jq '.[0].URI' | sed -E 's|.+://.+@.+:([[:digit:]]+)/.+|\1|') -L'/tmp/podman.sock:/run/user/$(id -u)/podman/podman.sock' -N core@localhost
