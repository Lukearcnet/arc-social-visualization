FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production

# Copy the rest of the application
COPY . .

# Expose port
EXPOSE 8080

# Start the application
CMD ["node", "index.js"]