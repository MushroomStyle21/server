cconst WebSocket = require('ws');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// SLITHER.IO EXACT CONSTANTS
const WORLD_SIZE = 5000;
const SEGMENT_RADIUS = 22;
const BASE_SPEED = 5.2;
const BOOST_SPEED = 9.8;
const BOOST_LOSS_RATE = 0.15;
const TURN_SPEED = 0.052;
const MIN_SNAKE_LENGTH = 15;
const FOOD_SIZE = 6;
const MONEY_BALL_SIZE = 10;
const COLLISION_CHECK_DISTANCE = 250;
const FOOD_COUNT = 800;
const MONEY_BALL_SPAWN_RATE = 0.05;

const rooms = new Map();

class GameRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = new Map();
    this.food = [];
    this.moneyBalls = [];
    this.lastUpdate = Date.now();
    this.started = false;
    
    this.spawnFood(FOOD_COUNT);
    this.spawnMoneyBalls(50);
  }

  spawnFood(count) {
    for (let i = 0; i < count; i++) {
      this.food.push({
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        size: FOOD_SIZE,
        color: `hsl(${Math.random() * 360}, 80%, 60%)`,
        value: 1
      });
    }
  }

  spawnMoneyBalls(count) {
    for (let i = 0; i < count; i++) {
      this.moneyBalls.push({
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        size: MONEY_BALL_SIZE,
        value: 0.1
      });
    }
  }

  addPlayer(playerId, playerData) {
    const snake = [];
    const startX = Math.random() * (WORLD_SIZE - 200) + 100;
    const startY = Math.random() * (WORLD_SIZE - 200) + 100;
    const startAngle = Math.random() * Math.PI * 2;
    
    for (let i = 0; i < MIN_SNAKE_LENGTH; i++) {
      snake.push({
        x: startX - Math.cos(startAngle) * i * (SEGMENT_RADIUS * 0.85),
        y: startY - Math.sin(startAngle) * i * (SEGMENT_RADIUS * 0.85)
      });
    }

    this.players.set(playerId, {
      id: playerId,
      data: playerData,
      snake: snake,
      direction: startAngle,
      targetDirection: startAngle,
      speed: BASE_SPEED,
      boosting: false,
      alive: true,
      score: 0,
      kills: 0,
      money: playerData.betAmount || 0,
      lastX: startX,
      lastY: startY
    });
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (player && player.alive) {
      const dropCount = Math.min(player.snake.length, 50);
      for (let i = 0; i < dropCount; i++) {
        const segment = player.snake[i];
        if (segment) {
          this.food.push({
            x: segment.x + (Math.random() - 0.5) * 40,
            y: segment.y + (Math.random() - 0.5) * 40,
            size: FOOD_SIZE * 1.2,
            color: player.data.color,
            value: 2
          });
        }
      }
    }
    this.players.delete(playerId);
  }

  update() {
    const now = Date.now();
    const delta = (now - this.lastUpdate) / 1000;
    this.lastUpdate = now;

    this.players.forEach((player) => {
      if (!player.alive) return;

      const head = player.snake[0];
      if (!head) return;

      const angleDiff = player.targetDirection - player.direction;
      let turnAmount = angleDiff;
      
      if (turnAmount > Math.PI) turnAmount -= Math.PI * 2;
      if (turnAmount < -Math.PI) turnAmount += Math.PI * 2;
      
      player.direction += turnAmount * TURN_SPEED;
      
      if (player.direction > Math.PI) player.direction -= Math.PI * 2;
      if (player.direction < -Math.PI) player.direction += Math.PI * 2;

      const currentSpeed = player.boosting ? BOOST_SPEED : BASE_SPEED;
      
      const newHead = {
        x: head.x + Math.cos(player.direction) * currentSpeed,
        y: head.y + Math.sin(player.direction) * currentSpeed
      };

      if (newHead.x < 0) newHead.x = WORLD_SIZE;
      if (newHead.x > WORLD_SIZE) newHead.x = 0;
      if (newHead.y < 0) newHead.y = WORLD_SIZE;
      if (newHead.y > WORLD_SIZE) newHead.y = 0;

      player.snake.unshift(newHead);

      let targetLength = player.snake.length;
      if (player.boosting && player.snake.length > MIN_SNAKE_LENGTH) {
        targetLength -= BOOST_LOSS_RATE;
      }

      while (player.snake.length > Math.floor(targetLength)) {
        player.snake.pop();
      }

      for (let i = this.food.length - 1; i >= 0; i--) {
        const food = this.food[i];
        const dx = head.x - food.x;
        const dy = head.y - food.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < SEGMENT_RADIUS + food.size) {
          this.food.splice(i, 1);
          
          const growth = food.value * 2;
          for (let g = 0; g < growth; g++) {
            const tail = player.snake[player.snake.length - 1];
            const prevTail = player.snake[player.snake.length - 2] || tail;
            player.snake.push({
              x: tail.x - (prevTail.x - tail.x) * 0.1,
              y: tail.y - (prevTail.y - tail.y) * 0.1
            });
          }
          
          player.score += food.value;
          this.spawnFood(1);
        }
      }

      for (let i = this.moneyBalls.length - 1; i >= 0; i--) {
        const ball = this.moneyBalls[i];
        const dx = head.x - ball.x;
        const dy = head.y - ball.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < SEGMENT_RADIUS + ball.size) {
          this.moneyBalls.splice(i, 1);
          player.money += ball.value;
          player.score += ball.value * 10;
          
          const tail = player.snake[player.snake.length - 1];
          player.snake.push({ x: tail.x, y: tail.y });
          
          if (Math.random() < 0.3) this.spawnMoneyBalls(1);
        }
      }

      this.players.forEach((otherPlayer) => {
        if (otherPlayer.id === player.id || !otherPlayer.alive) return;
        
        const otherHead = otherPlayer.snake[0];
        if (!otherHead) return;
        
        const hdx = head.x - otherHead.x;
        const hdy = head.y - otherHead.y;
        const headDist = Math.sqrt(hdx * hdx + hdy * hdy);
        
        if (headDist > COLLISION_CHECK_DISTANCE) return;

        for (let i = 3; i < otherPlayer.snake.length; i++) {
          const segment = otherPlayer.snake[i];
          const dx = head.x - segment.x;
          const dy = head.y - segment.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < SEGMENT_RADIUS * 1.8) {
            player.alive = false;
            otherPlayer.kills++;
            otherPlayer.score += Math.floor(player.snake.length * 2);
            otherPlayer.money += player.money * 0.5;
            
            player.snake.forEach((seg, idx) => {
              if (idx % 2 === 0) {
                this.food.push({
                  x: seg.x + (Math.random() - 0.5) * 30,
                  y: seg.y + (Math.random() - 0.5) * 30,
                  size: FOOD_SIZE * 1.3,
                  color: player.data.color,
                  value: 3
                });
              }
            });
            return;
          }
        }
      });

      if (this.food.length < FOOD_COUNT * 0.8) {
        this.spawnFood(20);
      }

      if (Math.random() < MONEY_BALL_SPAWN_RATE && this.moneyBalls.length < 100) {
        this.spawnMoneyBalls(1);
      }
    });
  }

  getState() {
    const players = [];
    this.players.forEach((player) => {
      players.push({
        id: player.id,
        data: player.data,
        snake: player.snake,
        direction: player.direction,
        alive: player.alive,
        score: player.score,
        kills: player.kills,
        money: player.money
      });
    });

    return {
      type: 'gameState',
      players: players,
      food: this.food,
      moneyBalls: this.moneyBalls
    };
  }
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  let playerId = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'join':
          playerId = message.playerId;
          const roomId = message.roomId;
          
          if (!rooms.has(roomId)) {
            rooms.set(roomId, new GameRoom(roomId));
          }
          
          currentRoom = rooms.get(roomId);
          currentRoom.addPlayer(playerId, message.playerData);
          
          ws.send(JSON.stringify({
            type: 'joined',
            roomId: roomId,
            playerId: playerId
          }));
          break;

        case 'input':
          if (currentRoom && playerId) {
            const player = currentRoom.players.get(playerId);
            if (player) {
              player.targetDirection = message.input.direction;
              player.boosting = message.input.boosting;
            }
          }
          break;

        case 'leave':
        case 'cashout':
          if (currentRoom && playerId) {
            currentRoom.removePlayer(playerId);
            
            if (currentRoom.players.size === 0) {
              rooms.delete(currentRoom.roomId);
            }
          }
          break;
      }
    } catch (err) {
      console.error('Error:', err);
    }
  });

  ws.on('close', () => {
    if (currentRoom && playerId) {
      currentRoom.removePlayer(playerId);
      if (currentRoom.players.size === 0) {
        rooms.delete(currentRoom.roomId);
      }
    }
  });
});

setInterval(() => {
  rooms.forEach((room) => {
    room.update();
    const state = room.getState();
    
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(state));
      }
    });
  });
}, 1000 / 30);

app.get('/', (req, res) => {
  res.json({ 
    status: 'online',
    rooms: rooms.size,
    totalPlayers: Array.from(rooms.values()).reduce((sum, room) => sum + room.players.size, 0)
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
