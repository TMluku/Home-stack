FROM node:24-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile=false

COPY . .

ENV NODE_ENV=production
ENV PORT=4173
EXPOSE 4173

CMD ["pnpm", "start"]
