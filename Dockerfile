FROM node:24-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm build

ENV NODE_ENV=production
ENV PORT=4173
EXPOSE 4173

CMD ["pnpm", "start"]
