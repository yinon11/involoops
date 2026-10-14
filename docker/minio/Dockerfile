# MinIO server and mc, built from source.
#
# MinIO deleted minio/minio and minio/mc from Docker Hub (2026-09-11) and
# quay.io stopped serving anonymous pulls, so the published images cannot be
# pulled again. Production currently runs on the locally cached images plus a
# tar.gz rescue archive (minio-images-2026-10-03.tar.gz, on the server and in
# ~/backups on the laptop). This Dockerfile is the forward path: the source is
# AGPL and stays cloneable from GitHub, so we can rebuild the exact running
# releases — or move to a newer tag — without any MinIO-controlled registry.
#
# The two ARGs pin the releases that production runs today. To upgrade, bump
# them to a newer tag from https://github.com/minio/minio/tags (and mc/tags)
# and rebuild.
#
# Build (context is this directory, not the repo root):
#   docker build --target minio -t minio/minio:latest docker/minio
#   docker build --target mc    -t minio/mc:latest    docker/minio
# Tagging the builds with the upstream names means docker-compose.yml keeps
# working unchanged; the cached/loaded images are simply shadowed.

ARG MINIO_RELEASE=RELEASE.2025-09-07T16-13-09Z
ARG MC_RELEASE=RELEASE.2025-08-13T08-35-41Z

FROM golang:1.24-alpine AS toolchain
RUN apk add --no-cache git

# Upstream injects the version via ldflags (buildscripts/gen-ldflags.go); a
# plain `go build` would report DEVELOPMENT.GOGET and break `--version`-based
# checks. We replicate the three -X flags: Version is the tag's timestamp in
# RFC3339 (dashes in the time part become colons), ReleaseTag the tag itself.

FROM toolchain AS build-minio
ARG MINIO_RELEASE
RUN git clone --depth 1 --branch "${MINIO_RELEASE}" https://github.com/minio/minio.git /src
WORKDIR /src
RUN set -eux; \
    version="$(printf %s "${MINIO_RELEASE}" | sed -E 's/^RELEASE\.//; s/T([0-9]{2})-([0-9]{2})-([0-9]{2})Z$/T\1:\2:\3Z/')"; \
    commit="$(git rev-parse HEAD)"; \
    CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w \
        -X github.com/minio/minio/cmd.Version=${version} \
        -X github.com/minio/minio/cmd.ReleaseTag=${MINIO_RELEASE} \
        -X github.com/minio/minio/cmd.CommitID=${commit} \
        -X github.com/minio/minio/cmd.ShortCommitID=${commit} \
        -X github.com/minio/minio/cmd.CopyrightYear=${version%%-*}" \
      -o /out/minio .

FROM toolchain AS build-mc
ARG MC_RELEASE
RUN git clone --depth 1 --branch "${MC_RELEASE}" https://github.com/minio/mc.git /src
WORKDIR /src
RUN set -eux; \
    version="$(printf %s "${MC_RELEASE}" | sed -E 's/^RELEASE\.//; s/T([0-9]{2})-([0-9]{2})-([0-9]{2})Z$/T\1:\2:\3Z/')"; \
    commit="$(git rev-parse HEAD)"; \
    CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w \
        -X github.com/minio/mc/cmd.Version=${version} \
        -X github.com/minio/mc/cmd.ReleaseTag=${MC_RELEASE} \
        -X github.com/minio/mc/cmd.CommitID=${commit} \
        -X github.com/minio/mc/cmd.ShortCommitID=${commit} \
        -X github.com/minio/mc/cmd.CopyrightYear=${version%%-*}" \
      -o /out/mc .

FROM alpine:3.21 AS minio
RUN apk add --no-cache ca-certificates
COPY --from=build-minio /out/minio /usr/bin/minio
COPY docker-entrypoint.sh /usr/bin/docker-entrypoint.sh
RUN chmod +x /usr/bin/docker-entrypoint.sh
EXPOSE 9000 9001
VOLUME ["/data"]
# Same entrypoint contract as the upstream image: docker-compose.yml passes
# `command: server /data --console-address ":9001"` without the binary name.
ENTRYPOINT ["/usr/bin/docker-entrypoint.sh"]
CMD ["minio"]

FROM alpine:3.21 AS mc
RUN apk add --no-cache ca-certificates
COPY --from=build-mc /out/mc /usr/bin/mc
# compose's minio-init overrides the entrypoint with `/bin/sh -c` and calls
# `mc` from PATH, so this default only matters for ad-hoc `docker run`.
ENTRYPOINT ["mc"]
