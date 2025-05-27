FROM mcr.microsoft.com/devcontainers/typescript-node:1-20-bullseye

WORKDIR /app
COPY ./package-lock.json ./
COPY ./package.json ./
RUN npm ci
COPY ./ ./

RUN tsc

ENTRYPOINT ["node", "dist/main.js"]