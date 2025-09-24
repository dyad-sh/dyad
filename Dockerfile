# Etapa 1: build
FROM node:20-bullseye AS build
# (usei bullseye em vez de alpine porque o better-sqlite3 é chatinho no alpine)

WORKDIR /app

# Instalar dependências de build
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copiar arquivos de dependências
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./

# Instalar dependências
RUN yarn install --frozen-lockfile || npm install

# Copiar resto do projeto
COPY . .

# Build do app (se tiver)
RUN yarn build || echo "sem etapa de build"

# Etapa 2: imagem final
FROM node:20-bullseye

WORKDIR /app

# Copiar app pronto
COPY --from=build /app ./

EXPOSE 3000

CMD ["yarn", "start"]
