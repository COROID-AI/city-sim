// Snake Game Implementation

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreValue = document.getElementById('scoreValue');
const gameOverDiv = document.getElementById('gameOver');

// Game constants
const GRID_SIZE = 20;
const GRID_WIDTH = 20;
const GRID_HEIGHT = 20;
const CANVAS_WIDTH = GRID_WIDTH * GRID_SIZE;
const CANVAS_HEIGHT = GRID_HEIGHT * GRID_SIZE;

// Set canvas size
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

// Game state
let snake = [{ x: 10, y: 10 }];
let direction = { x: 0, y: -1 }; // Starting direction: up
let food = { x: 5, y: 5 };
let score = 0;
let gameOver = false;
let gameSpeed = 150; // milliseconds between frames
let lastRender = 0;

// Input handling: allow only one direction change per frame
let inputPending = false;

// Initialize game
function initGame() {
    resetGame();
    gameOverDiv.classList.remove('show');
    document.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(gameLoop);
}

// Reset game to initial state
function resetGame() {
    snake = [{ x: 10, y: 10 }];
    direction = { x: 0, y: -1 };
    food = generateFood();
    score = 0;
    gameOver = false;
    scoreValue.textContent = score;
    inputPending = false;
}

// Generate random food position
function generateFood() {
    let newFood;
    do {
        newFood = {
            x: Math.floor(Math.random() * GRID_WIDTH),
            y: Math.floor(Math.random() * GRID_HEIGHT)
        };
    } while (snake.some(segment => segment.x === newFood.x && segment.y === newFood.y));
    return newFood;
}

// Handle keyboard input
function handleKeyDown(event) {
    if (inputPending) {
        // Ignore additional input until next frame
        return;
    }
    
    const key = event.key;
    let newDirection = null;
    
    switch (key) {
        case 'ArrowUp':
            if (direction.y !== 1) newDirection = { x: 0, y: -1 };
            break;
        case 'ArrowDown':
            if (direction.y !== -1) newDirection = { x: 0, y: 1 };
            break;
        case 'ArrowLeft':
            if (direction.x !== 1) newDirection = { x: -1, y: 0 };
            break;
        case 'ArrowRight':
            if (direction.x !== -1) newDirection = { x: 1, y: 0 };
            break;
        case ' ':
        case 'Enter':
            if (gameOver) {
                initGame();
                return;
            }
            break;
    }
    
    if (newDirection) {
        direction = newDirection;
        inputPending = true;
    }
}

// Update game state
function update() {
    if (gameOver) return;
    
    // Reset input pending for next frame
    inputPending = false;
    
    // Move snake
    const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
    
    // Check wall collision
    if (head.x < 0 || head.x >= GRID_WIDTH || head.y < 0 || head.y >= GRID_HEIGHT) {
        gameOver = true;
        return;
    }
    
    // Check self collision
    for (let i = 0; i < snake.length; i++) {
        if (snake[i].x === head.x && snake[i].y === head.y) {
            gameOver = true;
            return;
        }
    }
    
    // Add new head
    snake.unshift(head);
    
    // Check food collision
    if (head.x === food.x && head.y === food.y) {
        score++;
        scoreValue.textContent = score;
        food = generateFood();
        // Increase speed slightly as score increases
        gameSpeed = Math.max(50, 150 - score * 2);
    } else {
        // Remove tail if no food eaten
        snake.pop();
    }
}

// Render game
function render() {
    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Draw snake
    ctx.fillStyle = '#0f0';
    snake.forEach((segment, index) => {
        ctx.fillRect(
            segment.x * GRID_SIZE,
            segment.y * GRID_SIZE,
            GRID_SIZE - 2,
            GRID_SIZE - 2
        );
        // Make head slightly different color
        if (index === 0) {
            ctx.fillStyle = '#0c0';
            ctx.fillRect(
                segment.x * GRID_SIZE,
                segment.y * GRID_SIZE,
                GRID_SIZE - 2,
                GRID_SIZE - 2
            );
            ctx.fillStyle = '#0f0';
        }
    });
    
    // Draw food
    ctx.fillStyle = '#f00';
    ctx.fillRect(
        food.x * GRID_SIZE,
        food.y * GRID_SIZE,
        GRID_SIZE - 2,
        GRID_SIZE - 2
    );
    
    // Draw game over overlay
    if (gameOver) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.fillStyle = '#fff';
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Game Over!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);
        ctx.fillText('Score: ' + score, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 10);
        ctx.fillText('Press any key to restart', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40);
        gameOverDiv.classList.add('show');
    }
}

// Game loop
function gameLoop(timestamp) {
    if (!lastRender) lastRender = timestamp;
    const delta = timestamp - lastRender;
    
    if (delta > gameSpeed) {
        update();
        render();
        lastRender = timestamp;
    }
    
    if (!gameOver) {
        requestAnimationFrame(gameLoop);
    } else {
        render(); // Render final state
    }
}

// Start the game when page loads
window.addEventListener('load', initGame);

// Also handle restart via game over div click
gameOverDiv.addEventListener('click', () => {
    if (gameOver) {
        initGame();
    }
});