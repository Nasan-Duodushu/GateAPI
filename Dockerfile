FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/
COPY web/ ./web/
COPY config.example.json ./

RUN mkdir -p data

EXPOSE 3000

CMD ["node", "src/index.js"]
