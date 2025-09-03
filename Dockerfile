FROM node:20-alpine

# Install dependencies for file watching
RUN apk add --no-cache bash

WORKDIR /app

# Copy only package manifests first for better Docker layer caching
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/
COPY proxy/package*.json ./proxy/

# Install all workspaces (root, frontend, backend, proxy)
RUN npm run install:all

# Copy the rest of the source
COPY . .

# Start all services concurrently
CMD ["npm", "start"]
