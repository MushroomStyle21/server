const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ 
      status: 'ok', 
      rooms: rooms.size,
      players: Array.from(rooms.values()).reduce((sum, room) => sum + room.players.size, 0)
    }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();

wss.on('connection', (ws) => {
  console.log('Client connected');
  
  let currentRoom = null;
  let playerId = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'join':
          handleJoin(ws, message);
          break;
        case 'input':
          handleInput(ws, message);
          break;
        case 'start':
          handleStart(ws, message);
          break;
        case 'leave':
          handleLeave(ws);
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    handleLeave(ws);
  });

  function handleJoin(ws, message) {
    const { roomId, playerId: pid, playerData } = message;
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        players: new Map(),
        gameState: null,
        started: false
      });
    }
    
    const room = rooms.get(roomId);
    currentRoom = roomId;
    playerId = pid;
    
    room.players.set(playerId, {
      ws,
      id: playerId,
      data: playerData,
      input: { direction: 0, boosting: false }
    });
    
    ws.send(JSON.stringify({
      type: 'joined',
      roomId,
      playerId
    }));
    
    broadcastToRoom(roomId, {
      type: 'playerJoined',
      playerId,
      playerData
    });
  }

  function handleInput(ws, message) {
    if (!currentRoom || !playerId) return;
    
    const room = rooms.get(currentRoom);
    if (!room) return;
    
    const player = room.players.get(playerId);
    if (player) {
      player.input = message.input;
    }
  }

  function handleStart(ws, message) {
    if (!currentRoom) return;
    
    const room = rooms.get(currentRoom);
    if (!room) return;
    
    room.started = true;
    
    broadcastToRoom(currentRoom, {
      type: 'gameStarted'
    });
    
    startGameLoop(currentRoom);
  }

  function handleLeave(ws) {
    if (!currentRoom || !playerId) return;
    
    const room = rooms.get(currentRoom);
    if (room) {
      room.players.delete(playerId);
      
      broadcastToRoom(currentRoom, {
        type: 'playerLeft',
        playerId
      });
      
      if (room.players.size === 0) {
        rooms.delete(currentRoom);
      }
    }
    
    currentRoom = null;
    playerId = null;
  }
});

function broadcastToRoom(roomId, message) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const data = JSON.stringify(message);
  room.players.forEach((player) => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  });
}

function startGameLoop(roomId) {
  const room = rooms.get(roomId);
  if (!room || !room.started) return;
  
  const interval = setInterval(() => {
    if (!rooms.has(roomId) || room.players.size === 0) {
      clearInterval(interval);
      return;
    }
    
    const gameState = {
      type: 'gameState',
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        data: p.data,
        input: p.input
      }))
    };
    
    broadcastToRoom(roomId, gameState);
  }, 1000 / 30);
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
