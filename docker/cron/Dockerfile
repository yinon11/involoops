# Scheduler for the app's /api/cron/* routes.
#
# A service of its own, not crond bolted into the app image: one process per
# container, a dead scheduler is visible in `docker compose ps`, and a heavy
# run (the first shaam-retry-pending draining a backlog) cannot compete with
# request serving for the app container's memory.
#
# It exists at all because the schedule has to deploy with the code. Living
# in the host crontab is how seven routes silently never ran — see
# docs/ita-compliance/KNOWN_ISSUES.md.
FROM alpine:3.21

# bash    — cron-post.sh is bash, not POSIX sh
# curl    — the actual request
# tzdata  — so TZ=Asia/Jerusalem means something; without it the container
#           is UTC and every "0 6 * * *" silently drifts by 2-3 hours
RUN apk add --no-cache bash curl tzdata

WORKDIR /app
COPY scripts/cron-post.sh /app/scripts/cron-post.sh
COPY docker/cron/crontab /etc/crontabs/root
RUN chmod +x /app/scripts/cron-post.sh && chmod 0600 /etc/crontabs/root

# -f  foreground, so the container lives as long as the scheduler does
# -d 8  log to stderr at the default level → visible in `docker compose logs`
# -c  spool dir stated explicitly rather than relying on the busybox default
CMD ["crond", "-f", "-d", "8", "-c", "/etc/crontabs"]
