const WebSocket = require('ws');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

// Game constants - OPTIMIZED FOR SPEED
const WORLD_SIZE = 5000;
const SEGMENT_RADIUS = 18; // ALL SEGMENTS SAME SIZE
const BASE_SPEED = 4;
const BOOST_SPEED = 7;
const INITIAL_LENGTH = 60;
const FOOD_COUNT = 200; // Reduced for performance
const BOOST_COST_RATE = 0.05; // Money cost per frame when boosting

const rooms = new Map();

class GameRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = new Map();
    this.food = [];
    this.moneyBalls = []; // Only from dead players
    this.gameLoop = null;
    this.initFood();
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

  addPlayer(playerId, playerData, ws) {
    const startX = Math.random() * WORLD_SIZE;
    const startY = Math.random() * WORLD_SIZE;
    
    const snake = [];
    for (let i = 0; i < INITIAL_LENGTH; i++) {
      snake.push({ x: startX - i * 5, y: startY });
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

    console.log(`✅ ${playerId} joined. Total: ${this.players.size}`);

    if (!this.gameLoop) this.startGameLoop();
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    
    // Drop all money as loot when leaving
    if (player && player.money > 0) {
      const lootCount = Math.floor(player.money / 0.10);
      const head = player.snake[0];
      for (let i = 0; i < lootCount; i++) {
        this.moneyBalls.push({
          x: head.x + (Math.random() - 0.5) * 300,
          y: head.y + (Math.random() - 0.5) * 300,
          size: 12,
          value: 0.10
        });
      }
    }
    
    this.players.delete(playerId);
    console.log(`👋 ${playerId} left. Remaining: ${this.players.size}`);
    
    if (this.players.size === 0) {
      this.stopGameLoop();
      rooms.delete(this.roomId);
      console.log(`🗑️ Room ${this.roomId} deleted`);
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
    console.log(`🎮 Starting game for room ${this.roomId}`);
    this.gameLoop = setInterval(() => {
      this.updateGame();
      this.broadcastGameState();
    }, 1000 / 60); // 60 FPS for smooth gameplay
  }

  stopGameLoop() {
    if (this.gameLoop) {
      clearInterval(this.gameLoop);
      this.gameLoop = null;
    }
  }

  updateGame() {
    this.players.forEach((player) => {
      if (!player.alive) return;

      const speed = player.boosting ? BOOST_SPEED : BASE_SPEED;
      
      // Boost costs money
      if (player.boosting && player.money > 0) {
        player.money = Math.max(0, player.money - BOOST_COST_RATE);
      }
      
      const head = player.snake[0];
      const newHead = {
        x: head.x + Math.cos(player.direction) * speed,
        y: head.y + Math.sin(player.direction) * speed
      };

      // World wrap
      if (newHead.x < 0) newHead.x = WORLD_SIZE;
      if (newHead.x > WORLD_SIZE) newHead.x = 0;
      if (newHead.y < 0) newHead.y = WORLD_SIZE;
      if (newHead.y > WORLD_SIZE) newHead.y = 0;

      player.snake.unshift(newHead);
      player.snake.pop();

      // Food collision
      this.food = this.food.filter(food => {
        const dx = newHead.x - food.x;
        const dy = newHead.y - food.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < SEGMENT_RADIUS + food.size) {
          player.snake.push({ x: newHead.x, y: newHead.y });
          player.score += 1;
          
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

      // Money ball collision
      this.moneyBalls = this.moneyBalls.filter(ball => {
        const dx = newHead.x - ball.x;
        const dy = newHead.y - ball.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < SEGMENT_RADIUS + ball.size) {
          player.money += ball.value;
          player.score += 5;
          return false;
        }
        return true;
      });

      // Snake collision
      this.players.forEach((otherPlayer) => {
        if (otherPlayer.id === player.id || !otherPlayer.alive) return;

        otherPlayer.snake.forEach((segment) => {
          const dx = newHead.x - segment.x;
          const dy = newHead.y - segment.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist < SEGMENT_RADIUS * 1.8) {
            player.alive = false;
            otherPlayer.kills += 1;
            otherPlayer.score += 50;
            
            // Drop ALL money as loot when killed
            if (player.money > 0) {
              const lootCount = Math.floor(player.money / 0.10);
              for (let i = 0; i < lootCount; i++) {
                this.moneyBalls.push({
                  x: newHead.x + (Math.random() - 0.5) * 300,
                  y: newHead.y + (Math.random() - 0.5) * 300,
                  size: 12,
                  value: 0.10
                });
              }
              console.log(`💀 ${player.id} killed - dropped $${player.money.toFixed(2)} loot`);
            }
          }
        });
      });

      // Boost shrinks snake
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
  console.log('🔌 New connection');
  
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
        
        ws.send(JSON.stringify({ type: 'joined', roomId: currentRoomId, playerId: currentPlayerId }));
        ws.send(JSON.stringify({ type: 'gameStarted' }));
        break;

      case 'input':
        if (currentRoomId && currentPlayerId) {
          const room = rooms.get(currentRoomId);
          if (room) room.updatePlayerInput(currentPlayerId, message.input);
        }
        break;

      case 'leave':
      case 'cashout':
        if (currentRoomId && currentPlayerId) {
          const room = rooms.get(currentRoomId);
          if (room) room.removePlayer(currentPlayerId);
        }
        break;
    }
  });

  ws.on('close', () => {
    if (currentRoomId && currentPlayerId) {
      const room = rooms.get(currentRoomId);
      if (room) room.removePlayer(currentPlayerId);
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: rooms.size,
    players: Array.from(rooms.values()).reduce((sum, room) => sum + room.players.size, 0)
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
