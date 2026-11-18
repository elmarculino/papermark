# [fork] One image for the self-hosted app and the jobs worker.
#
#   docker build --secret id=buildenv,src=build.env -t papermark .
#
# `build.env` holds the build-time settings as KEY=value lines: the
# NEXT_PUBLIC_* values (inlined into the client bundle), the upload
# distribution host (next/image), JOBS_BACKEND, and placeholder values for the
# server secrets `next build` insists on. It is mounted as a BuildKit secret
# and never stored in a layer. The real secrets come from the container env at
# runtime. Commands:
#   app:     npx next start -p 3000
#   worker:  npm run jobs:worker
#   migrate: npx prisma migrate deploy
FROM node:24-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=buildenv,required=true \
  set -a && . /run/secrets/buildenv && set +a \
  && NODE_OPTIONS=--max-old-space-size=4096 npm run build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
