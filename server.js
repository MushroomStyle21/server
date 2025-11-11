const WebSocket = require('ws');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

const WORLD_SIZE = 5000;
const SEGMENT_RADIUS = 18;
const BASE_SPEED = 5;
const BOOST_SPEED = 8;
const INITIAL_LENGTH = 60;
const FOOD_COUNT = 150;

const rooms = new Map();

class GameRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = new Map();
    this.food = [];
    this.moneyBalls = [];
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
      snake.push({ x: startX - i * 6, y: startY });
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

    console.log(`✅ ${playerId} joined (${this.players.size} total)`);
    if (!this.gameLoop) this.startGameLoop();
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    
    if (player && player.money > 0) {
      const lootCount = Math.floor(player.money / 0.10);
      const head = player.snake[0];
      for (let i = 0; i < lootCount; i++) {
        this.moneyBalls.push({
          x: head.x + (Math.random() - 0.5) * 250,
          y: head.y + (Math.random() - 0.5) * 250,
          size: 12,
          value: 0.10
        });
      }
    }
    
    this.players.delete(playerId);
    console.log(`👋 ${playerId} left (${this.players.size} remain)`);
    
    if (this.players.size === 0) {
      this.stopGameLoop();
      rooms.delete(this.roomId);
    }
  }

  updatePlayerInput(playerId, input) {
    const player = this.players.get(playerId);
    if (player?.alive) {
      player.direction = input.direction;
      player.boosting = input.boosting;
    }
  }

  startGameLoop() {
    this.gameLoop = setInterval(() => {
      this.updateGame();
      this.broadcastGameState();
    }, 1000 / 60);
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
      const head = player.snake[0];
      const newHead = {
        x: head.x + Math.cos(player.direction) * speed,
        y: head.y + Math.sin(player.direction) * speed
      };

      if (newHead.x < 0) newHead.x = WORLD_SIZE;
      if (newHead.x > WORLD_SIZE) newHead.x = 0;
      if (newHead.y < 0) newHead.y = WORLD_SIZE;
      if (newHead.y > WORLD_SIZE) newHead.y = 0;

      player.snake.unshift(newHead);
      player.snake.pop();

      this.food = this.food.filter(food => {
        const dx = newHead.x - food.x;
        const dy = newHead.y - food.y;
        
        if (Math.sqrt(dx * dx + dy * dy) < SEGMENT_RADIUS + food.size) {
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

      this.moneyBalls = this.moneyBalls.filter(ball => {
        const dx = newHead.x - ball.x;
        const dy = newHead.y - ball.y;
        
        if (Math.sqrt(dx * dx + dy * dy) < SEGMENT_RADIUS + ball.size) {
          player.money += ball.value;
          player.score += 5;
          return false;
        }
        return true;
      });

      this.players.forEach((other) => {
        if (other.id === player.id || !other.alive) return;

        other.snake.forEach((seg) => {
          const dx = newHead.x - seg.x;
          const dy = newHead.y - seg.y;
          
          if (Math.sqrt(dx * dx + dy * dy) < SEGMENT_RADIUS * 1.8) {
            player.alive = false;
            other.kills += 1;
            other.score += 50;
            
            if (player.money > 0) {
              const lootCount = Math.floor(player.money / 0.10);
              for (let i = 0; i < lootCount; i++) {
                this.moneyBalls.push({
                  x: newHead.x + (Math.random() - 0.5) * 250,
                  y: newHead.y + (Math.random() - 0.5) * 250,
                  size: 12,
                  value: 0.10
                });
              }
            }
          }
        });
      });

      if (player.boosting && player.snake.length > 20) {
        player.snake.pop();
      }
    });
  }

  broadcastGameState() {
    const state = {
      type: 'gameState',
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        data: p.data,
        snake: p.snake,
        alive: p.alive,
        score: p.score,
        kills: p.kills,
        money: p.money
      })),
      food: this.food,
      moneyBalls: this.moneyBalls
    };

    this.players.forEach((p) => {
      if (p.ws?.readyState === WebSocket.OPEN) {
        p.ws.send(JSON.stringify(state));
      }
    });
  }
}

wss.on('connection', (ws) => {
  let playerId = null;
  let roomId = null;

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    
    switch (msg.type) {
      case 'join':
        roomId = msg.roomId;
        playerId = msg.playerId;
        
        if (!rooms.has(roomId)) {
          rooms.set(roomId, new GameRoom(roomId));
        }
        
        rooms.get(roomId).addPlayer(playerId, msg.playerData, ws);
        ws.send(JSON.stringify({ type: 'joined', roomId, playerId }));
        ws.send(JSON.stringify({ type: 'gameStarted' }));
        break;

      case 'input':
        if (roomId && playerId) {
          rooms.get(roomId)?.updatePlayerInput(playerId, msg.input);
        }
        break;

      case 'leave':
      case 'cashout':
        if (roomId && playerId) {
          rooms.get(roomId)?.removePlayer(playerId);
        }
        break;
    }
  });

  ws.on('close', () => {
    if (roomId && playerId) {
      rooms.get(roomId)?.removePlayer(playerId);
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

server.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
