# Stage 1: build the app
FROM node:20-alpine AS build

RUN npm install -g npm@latest

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: run the app
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY --from=build /app ./

EXPOSE 1337

CMD ["npm", "run", "start"]