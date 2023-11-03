const WebSocket = require('ws');
const msgpack = require('msgpack-lite');

const tileSize = 10;
const gridSize = 60;
const foodCount = 15; // Set the desired number of foods on the screen
const baseSpeed = .5;

const server = new WebSocket.Server({port: 8080});
const gameUpdateInterval = 50; // Update the game state at the same speed
const startGameBtn = {
    disabled: true
}

const clients = new Set();
let gameState = {
    players: [],
    gameStarted: false,
    food: [], // Change this to an array
};

for (let i = 0; i < foodCount; i++) {
    gameState.food.push(getRandomFoodPosition());
}


function encodeMessage(message) {
    return msgpack.encode(message);
}

function decodeMessage(data) {
    return msgpack.decode(data);
}

setInterval(() => {
    updateGameState();
    broadcastGameState();
}, gameUpdateInterval);

server.on('connection', (socket) => {
    console.log('Client connected');
    //socket.binaryType = 'arraybuffer';
    clients.add(socket);

    socket.on('message', (event) => {
        const data = decodeMessage(event);

        if (data.type === 'join') {
            const newPlayer = {
                id: gameState.players.length,
                score: 0,
                snake: createNewSnake(),
                isBot: data.isBot || false,

            };
            gameState.players.push(newPlayer);

            if (gameState.players.length >= 1) {
                startGameBtn.disabled = false;
            }

            socket.send(encodeMessage({type: 'playerInfo', player: newPlayer, isBot: newPlayer.isBot}));
        } else if (data.type === 'start') {
            gameState.gameStarted = true;
        } else if (data.type === 'direction') {
            const player = gameState.players.find((p) => p.id === data.player);
            // Add a verification step: check if the playerId sent by the client matches the playerId stored in the socket
            if (player) {
                pushToKeyQueue(data.key, player.snake);
            }
        } else if (data.type === 'space-key') {
            const player = gameState.players.find((p) => p.id === data.player);
            // Add a verification step: check if the playerId sent by the client matches the playerId stored in the socket
            if (player) {
                if (data.pressed) {
                    player.snake.spaceKeyIsPressed = data.pressed; // Update keyIsPressed property
                } else {
                    player.snake.spaceKeyIsPressed = data.pressed; // Update keyIsPressed property
                }

            }
        } else if (data.type === 'restart') {
            // Reset game state
            socket.send(encodeMessage({type: 'restart'}));

            gameState = {
                players: [],
                gameStarted: false,
                food: [],
            };

            // Generate new food
            for (let i = 0; i < foodCount; i++) {
                gameState.food.push(getRandomFoodPosition());
            }
        }
    });


    socket.on('close', () => {
        console.log('Client disconnected');
        clients.delete(socket);
    });
});


createGameUpdateMessage = (gameState) => {
    const players = gameState.players.map((player) => {
        return {
            i: player.id,
            c: player.color,
            s: {
                b: player.snake.body,
                c: player.snake.colissionCounter,
            },
            sc: player.score,
        };
    });

    return {
        p: players,
        f: gameState.food,
    };
}


function updateBotDirections() {
    gameState.players.forEach((player) => {
        if (player.isBot) {
            const newDirection = findDirectionTowardsNearestFood(player.snake.body[0], gameState.food);
            changeDirection(newDirection, player.snake);
        }
    });
}

function findDirectionTowardsNearestFood(head, foodArray) {
    const nearestFood = foodArray.reduce((prev, current) => {
        const prevDistance = Math.hypot(head.x - prev.x, head.y - prev.y);
        const currentDistance = Math.hypot(head.x - current.x, head.y - current.y);
        return prevDistance < currentDistance ? prev : current;
    });

    const deltaX = nearestFood.x - head.x;
    const deltaY = nearestFood.y - head.y;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
        return deltaX > 0 ? 'ArrowRight' : 'ArrowLeft';
    } else {
        return deltaY > 0 ? 'ArrowDown' : 'ArrowUp';
    }
}

function broadcastGameState() {
    const updateMessage = createGameUpdateMessage(gameState);
    const encodedGameState = encodeMessage(updateMessage);

    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(encodedGameState);
        }
    }
}

let isProcessingMoves = false;

function updateGameState() {
    if (!gameState.gameStarted) {
        return;
    }
    if (isProcessingMoves) {
        return;
    }
    isProcessingMoves = true;
    updateBotDirections();

    const allPositions = gameState.players.flatMap((player) => player.snake.body);

    gameState.players = gameState.players.filter((player) => player.snake.colissionCounter < 10); // Remove players with 10 or more collisions

    for (const player of gameState.players) {
        const snake = player.snake;
        snake.speed = snake.spaceKeyIsPressed ? baseSpeed * 2 : baseSpeed

        //Get direction from queue
        if (snake.keyQueue.length > 0) {
            const lastDirection = snake.keyQueue[snake.keyQueue.length - 1];
            if (changeDirection(lastDirection, snake)) {
                const newDirection = snake.keyQueue.shift();
                changeDirection(newDirection, snake);
            }
        }

        snake.calculatedHead = {
            x: snake.calculatedHead.x + snake.direction.x * snake.speed,
            y: snake.calculatedHead.y + snake.direction.y * snake.speed,
        }

        const newHead = {
            x: roundToNearestTen(snake.calculatedHead.x),
            y: roundToNearestTen(snake.calculatedHead.y),
        };

        if (Math.abs(newHead.x - snake.body[0].x) >= tileSize || Math.abs(newHead.y - snake.body[0].y) >= tileSize) {
            const collision = checkCollision(newHead, allPositions);

            if (collision) {
                if (!snake.isOnColission) {
                    snake.colissionCounter++;
                }
                snake.isOnColission = true;

                snake.calculatedHead = snake.body[0];
                snake.body = [snake.body[0]];
            } else {
                snake.isOnColission = false;
                let foodEaten = false;
                for (let i = 0; i < gameState.food.length; i++) {
                    if (newHead.x === gameState.food[i].x && newHead.y === gameState.food[i].y) {
                        gameState.food[i] = getRandomFoodPosition();
                        foodEaten = true;
                        // Send a message to the client
                        for (const client of clients) {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(encodeMessage({type: 'eat', playerId: player.id}));
                            }
                        }
                        player.score++;
                        break;
                    }
                }

                if (!foodEaten) {
                    snake.body.pop();
                }
                snake.body.unshift(newHead);
            }
            snake.directionChanged = false;
        }
    }
    isProcessingMoves = false;

}

function roundToNearestTen(num) {
    return Math.round(num / 10) * 10;
}

function checkCollision(position, allPositions) {
    return (
        position.x < 0 ||
        position.x >= gridSize * tileSize ||
        position.y < 0 ||
        position.y >= gridSize * tileSize ||
        allPositions.some((p) => p.x === position.x && p.y === position.y)
    );
}

function pushToKeyQueue(key, snake) {
    snake.keyQueue.push(key);
}

function changeDirection(key, snake) {
    if (snake.directionChanged && !snake.isOnColission) {
        return false;
    }
    const {x, y} = snake.direction;

    if (key === 'ArrowUp' && (y === 0 || snake.isOnColission)) {
        snake.direction = {x: 0, y: -tileSize};
        snake.directionChanged = true;
    }
    if (key === 'ArrowDown' && (y === 0 || snake.isOnColission)) {
        snake.direction = {x: 0, y: tileSize};
        snake.directionChanged = true;
    }
    if (key === 'ArrowLeft' && (x === 0 || snake.isOnColission)) {
        snake.direction = {x: -tileSize, y: 0};
        snake.directionChanged = true;
    }
    if (key === 'ArrowRight' && (x === 0 || snake.isOnColission)) {
        snake.direction = {x: tileSize, y: 0};
        snake.directionChanged = true;
    }

}


function getRandomFoodPosition() {
    let newPosition;
    while (newPosition === undefined || isPositionOccupied(newPosition)) {
        newPosition = {
            x: Math.floor(Math.random() * gridSize) * tileSize,
            y: Math.floor(Math.random() * gridSize) * tileSize,
        };
    }
    return newPosition;
}

function isPositionOccupied(position) {
    const allPositions = gameState.players.flatMap((player) => player.snake.body);
    return allPositions.some(
        (p) => p.x === position.x && p.y === position.y
    );
}


function createNewSnake() {
    const initialX = Math.floor(Math.random() * gridSize) * tileSize;
    const initialY = Math.floor(Math.random() * gridSize) * tileSize;
    return {
        body: [{x: initialX, y: initialY}],
        calculatedHead: {x: initialX, y: initialY},
        direction: {x: tileSize, y: 0},
        speed: baseSpeed, // Keep the snake's speed at 1
        spaceKeyIsPressed: false,
        directionChanged: false,
        keyQueue: [],
        isOnColission: false,
        colissionCounter: 0
    };
}

console.log('WebSocket server running on port 8080');