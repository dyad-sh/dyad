# Etapa 1: build
FROM node:20-alpine AS build

WORKDIR /app

# Copiar apenas arquivos de dependências primeiro
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./

# Instalar dependências
RUN yarn install --frozen-lockfile || npm install

# Copiar restante do código
COPY . .

# Gerar build (se o projeto precisar)
RUN yarn build || echo "sem etapa de build"

# Etapa 2: imagem final
FROM node:20-alpine

WORKDIR /app

# Copiar arquivos da etapa de build
COPY --from=build /app ./

# Expor a porta padrão do Dyad (ajuste se for diferente)
EXPOSE 3000

# Comando de inicialização
CMD ["yarn", "start"]
