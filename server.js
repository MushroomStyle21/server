const WebSocket = require('ws');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

// Game constants
const WORLD_SIZE = 5000;
const SEGMENT_RADIUS = 18; // ALL SEGMENTS SAME SIZE
const BASE_SPEED = 3;
const BOOST_SPEED = 5.5;
const INITIAL_LENGTH = 60;
const FOOD_COUNT = 300;
const MONEY_BALL_COUNT = 50;

// Game rooms
const rooms = new Map();

class GameRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = new Map();
    this.food = [];
    this.moneyBalls = [];
    this.gameLoop = null;
    
    this.initFood();
    this.initMoneyBalls();
  }

  initFood() {
    for (let i = 0; i < FOOD_COUNT; i++) {
      this.food.push({
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        size: 6,
        color: `hsl(${Math.random() * 360}, 80%, 60%)`
      });
    }
  }

  initMoneyBalls() {
    for (let i = 0; i < MONEY_BALL_COUNT; i++) {
      this.moneyBalls.push({
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        size: 12,
        value: 0.10
      });
    }
  }

  addPlayer(playerId, playerData, ws) {
    const startX = Math.random() * WORLD_SIZE;
    const startY = Math.random() * WORLD_SIZE;
    
    const snake = [];
    for (let i = 0; i < INITIAL_LENGTH; i++) {
      snake.push({
        x: startX,
        y: startY
      });
    }

    this.players.set(playerId, {
      id: playerId,
      data: playerData,
      snake: snake,
      direction: 0,
      boosting: false,
      alive: true,
      score: 0,
      kills: 0,
      money: playerData.betAmount || 0,
      ws: ws
    });

    console.log(`✅ Player ${playerId} joined room ${this.roomId}. Total players: ${this.players.size}`);

    if (!this.gameLoop) {
      this.startGameLoop();
    }
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
    console.log(`👋 Player ${playerId} left room ${this.roomId}. Remaining: ${this.players.size}`);
    
    if (this.players.size === 0) {
      this.stopGameLoop();
      rooms.delete(this.roomId);
      console.log(`🗑️ Room ${this.roomId} deleted (no players)`);
    }
  }

  updatePlayerInput(playerId, input) {
    const player = this.players.get(playerId);
    if (player && player.alive) {
      player.direction = input.direction;
      player.boosting = input.boosting;
    }
  }

  startGameLoop() {
    console.log(`🎮 Game loop started for room ${this.roomId}`);
    
    this.gameLoop = setInterval(() => {
      this.updateGame();
      this.broadcastGameState();
    }, 1000 / 30); // 30 FPS
  }

  stopGameLoop() {
    if (this.gameLoop) {
      clearInterval(this.gameLoop);
      this.gameLoop = null;
      console.log(`⏹️ Game loop stopped for room ${this.roomId}`);
    }
  }

  updateGame() {
    this.players.forEach((player) => {
      if (!player.alive) return;

      const speed = player.boosting ? BOOST_SPEED : BASE_SPEED;
      
      // Move head
      const head = player.snake[0];
      const newHead = {
        x: head.x + Math.cos(player.direction) * speed,
        y: head.y + Math.sin(player.direction) * speed
      };

      // Wrap around world boundaries
      if (newHead.x < 0) newHead.x = WORLD_SIZE;
      if (newHead.x > WORLD_SIZE) newHead.x = 0;
      if (newHead.y < 0) newHead.y = WORLD_SIZE;
      if (newHead.y > WORLD_SIZE) newHead.y = 0;

      // Add new head, remove tail
      player.snake.unshift(newHead);
      player.snake.pop();

      // Check food collision
      this.food = this.food.filter(food => {
        const dx = newHead.x - food.x;
        const dy = newHead.y - food.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < SEGMENT_RADIUS + food.size) {
          player.snake.push({ x: newHead.x, y: newHead.y });
          player.score += 1;
          
          // Spawn new food
          this.food.push({
            x: Math.random() * WORLD_SIZE,
            y: Math.random() * WORLD_SIZE,
            size: 6,
            color: `hsl(${Math.random() * 360}, 80%, 60%)`
          });
          
          return false;
        }
        return true;
      });

      // Check money ball collision
      this.moneyBalls = this.moneyBalls.filter(ball => {
        const dx = newHead.x - ball.x;
        const dy = newHead.y - ball.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < SEGMENT_RADIUS + ball.size) {
          player.money += ball.value;
          player.score += 5;
          
          // Spawn new money ball
          this.moneyBalls.push({
            x: Math.random() * WORLD_SIZE,
            y: Math.random() * WORLD_SIZE,
            size: 12,
            value: 0.10
          });
          
          return false;
        }
        return true;
      });

      // Check collision with other snakes
      this.players.forEach((otherPlayer) => {
        if (otherPlayer.id === player.id || !otherPlayer.alive) return;

        otherPlayer.snake.forEach((segment, idx) => {
          const dx = newHead.x - segment.x;
          const dy = newHead.y - segment.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist < SEGMENT_RADIUS * 2) {
            // Player died - drop loot
            player.alive = false;
            otherPlayer.kills += 1;
            
            // Drop money balls from dead player
            const lootCount = Math.floor(player.money / 0.10);
            for (let i = 0; i < lootCount; i++) {
              this.moneyBalls.push({
                x: newHead.x + (Math.random() - 0.5) * 200,
                y: newHead.y + (Math.random() - 0.5) * 200,
                size: 12,
                value: 0.10
              });
            }
            
            console.log(`💀 ${player.id} killed by ${otherPlayer.id}`);
          }
        });
      });

      // Boost cost
      if (player.boosting && player.snake.length > 20) {
        player.snake.pop();
      }
    });
  }

  broadcastGameState() {
    const gameState = {
      type: 'gameState',
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        data: p.data,
        snake: p.snake,
        direction: p.direction,
        alive: p.alive,
        score: p.score,
        kills: p.kills,
        money: p.money
      })),
      food: this.food,
      moneyBalls: this.moneyBalls
    };

    this.players.forEach((player) => {
      if (player.ws && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(JSON.stringify(gameState));
      }
    });
  }
}

wss.on('connection', (ws) => {
  console.log('🔌 New WebSocket connection');
  
  let currentPlayerId = null;
  let currentRoomId = null;

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    
    switch (message.type) {
      case 'join':
        currentRoomId = message.roomId;
        currentPlayerId = message.playerId;
        
        if (!rooms.has(currentRoomId)) {
          rooms.set(currentRoomId, new GameRoom(currentRoomId));
        }
        
        const room = rooms.get(currentRoomId);
        room.addPlayer(currentPlayerId, message.playerData, ws);
        
        ws.send(JSON.stringify({
          type: 'joined',
          roomId: currentRoomId,
          playerId: currentPlayerId
        }));
        
        ws.send(JSON.stringify({
          type: 'gameStarted'
        }));
        
        console.log(`✅ ${currentPlayerId} joined room ${currentRoomId}`);
        break;

      case 'input':
        if (currentRoomId && currentPlayerId) {
          const room = rooms.get(currentRoomId);
          if (room) {
            room.updatePlayerInput(currentPlayerId, message.input);
          }
        }
        break;

      case 'leave':
      case 'cashout':
        if (currentRoomId && currentPlayerId) {
          const room = rooms.get(currentRoomId);
          if (room) {
            room.removePlayer(currentPlayerId);
          }
        }
        break;
    }
  });

  ws.on('close', () => {
    console.log('🔌 Client disconnected');
    
    if (currentRoomId && currentPlayerId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        room.removePlayer(currentPlayerId);
      }
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: rooms.size,
    totalPlayers: Array.from(rooms.values()).reduce((sum, room) => sum + room.players.size, 0)
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
package.json (Railway)
{
  "name": "slither-server",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "ws": "^8.14.2",
    "express": "^4.18.2"
  }
}
