FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev || true

COPY . .

CMD ["node", "unified-sniper-upgrader.mjs"]
