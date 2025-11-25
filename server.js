const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static('public'));

// Game state
const waitingPlayers = [];
const activeGames = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('findGame', (playerName) => {
        console.log(`${playerName} is looking for a game`);

        // Check if there's a waiting player
        if (waitingPlayers.length > 0) {
            const opponent = waitingPlayers.shift();
            const gameId = `game_${Date.now()}`;

            // Create game
            const game = {
                id: gameId,
                player1: { id: opponent.id, name: opponent.name, socket: opponent.socket },
                player2: { id: socket.id, name: playerName, socket: socket },
                clickDiff: 0, // positive = player1 ahead, negative = player2 ahead
                status: 'active'
            };

            activeGames.set(gameId, game);

            // Join both players to game room
            opponent.socket.join(gameId);
            socket.join(gameId);

            // Notify both players
            opponent.socket.emit('gameStart', {
                gameId: gameId,
                position: 'player1',
                opponent: playerName
            });

            socket.emit('gameStart', {
                gameId: gameId,
                position: 'player2',
                opponent: opponent.name
            });

            console.log(`Game started: ${opponent.name} vs ${playerName}`);
        } else {
            // Add to waiting queue
            waitingPlayers.push({
                id: socket.id,
                name: playerName,
                socket: socket
            });
            socket.emit('waiting');
            console.log(`${playerName} added to waiting queue`);
        }
    });

    socket.on('click', (gameId) => {
        const game = activeGames.get(gameId);
        if (!game || game.status !== 'active') return;

        // Update click difference
        if (socket.id === game.player1.id) {
            game.clickDiff++;
        } else if (socket.id === game.player2.id) {
            game.clickDiff--;
        }

        // Check for winner
        if (Math.abs(game.clickDiff) >= 15) {
            const winner = game.clickDiff >= 15 ? game.player1 : game.player2;
            game.status = 'finished';
            game.winner = winner.name;

            // Notify both players
            io.to(gameId).emit('gameEnd', {
                winner: winner.name,
                clickDiff: game.clickDiff
            });

            console.log(`Game ended: ${winner.name} wins!`);

            // Clean up game after a delay
            setTimeout(() => {
                activeGames.delete(gameId);
            }, 5000);
        } else {
            // Broadcast update to both players
            io.to(gameId).emit('update', {
                clickDiff: game.clickDiff
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // Remove from waiting queue
        const waitingIndex = waitingPlayers.findIndex(p => p.id === socket.id);
        if (waitingIndex !== -1) {
            waitingPlayers.splice(waitingIndex, 1);
        }

        // Handle active games
        for (const [gameId, game] of activeGames.entries()) {
            if (game.player1.id === socket.id || game.player2.id === socket.id) {
                // Notify opponent that player left
                io.to(gameId).emit('opponentLeft');
                activeGames.delete(gameId);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
