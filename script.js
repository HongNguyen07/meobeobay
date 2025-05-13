const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreDisplayElement = document.getElementById('score-display');
const instructionsOverlay = document.getElementById('instructions-overlay');
const gameOverOverlay = document.getElementById('game-over-overlay');
const finalScoreDisplay = document.getElementById('final-score');
const restartButton = document.getElementById('restart-button');
const pauseButton = document.getElementById('pause-button');
const pauseOverlay = document.getElementById('pause-overlay');

// Game state
let gameState = 'start'; // 'start', 'playing', 'gameOver', 'paused'
let score = 0;
let animationFrameId = null;
let frameCount = 0;

// Cat properties
const cat = {
    x: 50,
    y: 150,
    width: 45,  
    height: 45, 
    velocityY: 0,
    gravity: 0.4,
    jumpStrength: -7,
    diveStrength: 5, 
    image: new Image()
};

// Pipe properties
const pipes = [];
const pipeSettings = {
    width: 70,
    gap: 140, 
    speed: 2.5,
    spawnInterval: 100, 
    color: '#FFC0CB', 
    cornerRadius: 10,
    doubleGapProbability: 0.4, 
    minSegmentHeight: 30 
};

// Sound Effects
let audioContext;
let jumpSoundBuffer, scoreSoundBuffer, hitSoundBuffer;

const catImagePath = 'fat_cat.png';
const jumpSoundPath = 'jump.mp3';
const scoreSoundPath = 'score.mp3';
const hitSoundPath = 'hit.mp3';

// Add spawn count and obstacle variables
let spawnCount = 0;
const obstacles = [];
const obstacleTypes = ['bird', 'cactus'];
const birdImage = new Image();
const cactusImage = new Image();

// Add a flag to skip gravity once when resuming so the fall speed stays the same
let skipGravityOnResume = false;

async function loadSound(url) {
    if (!audioContext) return null;
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        return audioBuffer;
    } catch (error) {
        console.error(`Error loading sound ${url}:`, error);
        return null;
    }
}

function playSound(buffer) {
    if (!audioContext || !buffer) return;
    if (audioContext.state === 'suspended') {
        audioContext.resume().catch(e => console.warn("Could not resume audio context for sound play:", e));
    }
    if (audioContext.state === 'running') {
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start(0);
    }
}

async function loadAssets() {
    return new Promise((resolve, reject) => {
        let assetsLoaded = 0;
        const totalAssets = 6; 

        const assetLoaded = () => {
            assetsLoaded++;
            if (assetsLoaded === totalAssets) {
                resolve();
            }
        };
        
        // cat image
        cat.image.onload = assetLoaded;
        cat.image.onerror = () => { reject(new Error("Failed to load cat image")); assetLoaded(); };
        cat.image.src = catImagePath;

        // bird image
        birdImage.onload = assetLoaded;
        birdImage.onerror = assetLoaded;
        birdImage.src = 'bird.png';

        // cactus image
        cactusImage.onload = assetLoaded;
        cactusImage.onerror = assetLoaded;
        cactusImage.src = 'cactus.png';

        // sounds 
        if (window.AudioContext || window.webkitAudioContext) {
            if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } else {
            console.warn("Web Audio API is not supported in this browser.");
        }
        if (audioContext) {
            Promise.all([
                loadSound(jumpSoundPath),
                loadSound(scoreSoundPath),
                loadSound(hitSoundPath)
            ]).then(([jump, scoreS, hit]) => {
                jumpSoundBuffer = jump;
                scoreSoundBuffer = scoreS;
                hitSoundBuffer = hit;
                assetLoaded(); assetLoaded(); assetLoaded();
            }).catch(err => {
                console.error("Error loading sounds:", err);
                assetLoaded(); assetLoaded(); assetLoaded();
            });
        } else {
            assetLoaded(); assetLoaded(); assetLoaded();
        }
    });
}

function resetGame() {
    cat.y = canvas.height / 2 - cat.height / 2;
    cat.velocityY = 0;
    pipes.length = 0;
    obstacles.length = 0;
    score = 0;
    scoreDisplayElement.textContent = `Điểm: ${score}`;
    frameCount = 0;
    gameState = 'playing';
    spawnCount = 0;
}

function startGameFlow() {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(e => console.error("Error resuming AudioContext:", e));
    }

    instructionsOverlay.style.display = 'none';
    gameOverOverlay.style.display = 'none';
    pauseButton.style.display = 'none';
    pauseOverlay.style.display = 'none';
    
    resetGame(); 

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    gameLoop();
}

function drawBackground() {
    ctx.fillStyle = '#70c5ce';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawCat() {
    if (cat.image.complete && cat.image.naturalHeight !== 0) {
         ctx.drawImage(cat.image, cat.x, cat.y, cat.width, cat.height);
    } else {
        ctx.fillStyle = 'yellow';
        ctx.fillRect(cat.x, cat.y, cat.width, cat.height);
    }
}

function updateCat() {
    if (skipGravityOnResume) {
        // preserve the current velocity without extra gravity this frame
        skipGravityOnResume = false;
        cat.y += cat.velocityY;
    } else {
        cat.velocityY += cat.gravity;
        cat.y += cat.velocityY;
    }
}

function addSingleGapPipe() {
    const minSolidHeight = 40; 
    const availableSpace = canvas.height - pipeSettings.gap - (minSolidHeight * 2);
    const topPipeHeight = Math.random() * availableSpace + minSolidHeight;

    pipes.push({
        x: canvas.width,
        type: 'single',
        topPipeHeight: topPipeHeight,
        passed: false
    });
}

function addPipe() {
    spawnCount++;
    // Determine single or double-gap based on spawn count
    let isDouble = false;
    if (spawnCount <= 10) {
        isDouble = false;
    } else if (spawnCount <= 30) {
        // alternate after 10
        isDouble = (spawnCount % 2 === 1);
    } else {
        // after 30, allow double by probability
        isDouble = Math.random() < pipeSettings.doubleGapProbability;
    }

    if (!isDouble) {
        addSingleGapPipe();
    } else {
        // --- existing double-gap pipe construction logic ---
        const gap1 = pipeSettings.gap;
        const gap2 = Math.floor(pipeSettings.gap * 2/3);
        const totalGap = gap1 + gap2;
        const totalSolidHeight = canvas.height - totalGap;
        // compute s1_h, s2_h, s3_h as before...
        let r1 = Math.random(), r2 = Math.random(), r3 = Math.random();
        let sum = r1 + r2 + r3;
        let s1_h = pipeSettings.minSegmentHeight + Math.floor((r1/sum) * (totalSolidHeight - 3*pipeSettings.minSegmentHeight));
        let s2_h = pipeSettings.minSegmentHeight + Math.floor((r2/sum) * (totalSolidHeight - 3*pipeSettings.minSegmentHeight));
        let s3_h = totalSolidHeight - s1_h - s2_h;
        if (s3_h < pipeSettings.minSegmentHeight) {
            let deficit = pipeSettings.minSegmentHeight - s3_h;
            if (s1_h > pipeSettings.minSegmentHeight + deficit) {
                s1_h -= deficit; s3_h += deficit;
            } else if (s2_h > pipeSettings.minSegmentHeight + deficit) {
                s2_h -= deficit; s3_h += deficit;
            } else {
                addSingleGapPipe();
                return;
            }
        }
        pipes.push({
            x: canvas.width,
            type: 'double',
            solid1_height: s1_h,
            solid2_height: s2_h,
            gap1: gap1,
            gap2: gap2,
            passed: false
        });
        // --- end double-gap logic (old obstacle-in-gap code removed) ---
    }

    // NEW: spawn bird or cactus obstacles at right edge once spawnCount > 30
    if (spawnCount > 30) {
        const obsType = obstacleTypes[Math.floor(Math.random() * obstacleTypes.length)];
        if (obsType === 'bird') {
            const obsW = 40, obsH = 30;
            // random vertical position within central band
            const yPos = Math.random() * (canvas.height - obsH * 2) + obsH;
            obstacles.push({
                x: canvas.width,
                y: yPos,
                width: obsW,
                height: obsH,
                image: birdImage,
                speed: pipeSettings.speed
            });
        } else { // cactus
            const obsW = 30, obsH = 50;
            // top or bottom
            const yPos = Math.random() < 0.5 ? 0 : canvas.height - obsH;
            obstacles.push({
                x: canvas.width,
                y: yPos,
                width: obsW,
                height: obsH,
                image: cactusImage,
                speed: pipeSettings.speed
            });
        }
    }
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    ctx.lineTo(x + radius, y + height);
    ctx.arcTo(x, y + height, x, y + height - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
    ctx.fill();
}

function drawPipes() {
    ctx.fillStyle = pipeSettings.color;
    pipes.forEach(pipe => {
        if (pipe.type === 'single') {
            drawRoundedRect(ctx, pipe.x, 0, pipeSettings.width, pipe.topPipeHeight, pipeSettings.cornerRadius);
            const bottomPipeY = pipe.topPipeHeight + pipeSettings.gap;
            drawRoundedRect(ctx, pipe.x, bottomPipeY, pipeSettings.width, canvas.height - bottomPipeY, pipeSettings.cornerRadius);
        } else if (pipe.type === 'double') {
            const s1 = pipe.solid1_height;
            const s2 = pipe.solid2_height;
            const gap1 = pipe.gap1;
            const gap2 = pipe.gap2;
            // top solid
            drawRoundedRect(ctx, pipe.x, 0, pipeSettings.width, s1, pipeSettings.cornerRadius);
            // middle solid
            const midY = s1 + gap1;
            drawRoundedRect(ctx, pipe.x, midY, pipeSettings.width, s2, pipeSettings.cornerRadius);
            // bottom solid
            const botY = midY + s2 + gap2;
            const botH = canvas.height - botY;
            if (botH > 0) {
                drawRoundedRect(ctx, pipe.x, botY, pipeSettings.width, botH, pipeSettings.cornerRadius);
            }
        }
    });
}

function updatePipes() {
    frameCount++;
    if (frameCount % pipeSettings.spawnInterval === 0) {
        addPipe();
    }

    for (let i = pipes.length - 1; i >= 0; i--) {
        const pipe = pipes[i];
        pipe.x -= pipeSettings.speed;

        if (!pipe.passed && pipe.x + pipeSettings.width < cat.x) {
            pipe.passed = true;
            score++;
            scoreDisplayElement.textContent = `Điểm: ${score}`;
            playSound(scoreSoundBuffer);
            if (score >= 15) pauseButton.style.display = 'block';
        }

        if (pipe.x + pipeSettings.width < 0) {
            pipes.splice(i, 1);
        }
    }
}

function updateObstacles() {
    for (let i = obstacles.length - 1; i >= 0; i--) {
        const o = obstacles[i];
        o.x -= o.speed;
        if (o.x + o.width < 0) obstacles.splice(i, 1);
    }
}

function drawObstacles() {
    obstacles.forEach(o => {
        ctx.drawImage(o.image, o.x, o.y, o.width, o.height);
    });
}

function checkCollisions() {
    if (cat.y + cat.height > canvas.height || cat.y < 0) {
        cat.y = Math.max(0, Math.min(cat.y, canvas.height - cat.height)); 
        setGameOverState();
        return;
    }

    for (const pipe of pipes) {
        const catRight = cat.x + cat.width;
        const catBottom = cat.y + cat.height;
        const pipeRight = pipe.x + pipeSettings.width;

        if (catRight > pipe.x && cat.x < pipeRight) { 
            if (pipe.type === 'single') {
                if (cat.y < pipe.topPipeHeight || catBottom > pipe.topPipeHeight + pipeSettings.gap) {
                    setGameOverState();
                    return;
                }
            } else if (pipe.type === 'double') {
                const s1 = pipe.solid1_height;
                const s2 = pipe.solid2_height;
                const gap1 = pipe.gap1;
                const gap2 = pipe.gap2;
                // top
                if (cat.y < s1) { setGameOverState(); return; }
                // middle solid
                const midY = s1 + gap1;
                if (cat.y + cat.height > midY && cat.y < midY + s2) { setGameOverState(); return; }
                // bottom
                const bottomZone = midY + s2 + gap2;
                if (cat.y + cat.height > bottomZone) { setGameOverState(); return; }
            }
        }
    }
    // obstacle collisions
    for (const o of obstacles) {
        if (
            cat.x + cat.width > o.x && cat.x < o.x + o.width &&
            cat.y + cat.height > o.y && cat.y < o.y + o.height
        ) {
            setGameOverState();
            return;
        }
    }
}

function setGameOverState() {
    if (gameState === 'gameOver') return; 
    gameState = 'gameOver';
    playSound(hitSoundBuffer);
    
    finalScoreDisplay.textContent = score;
    gameOverOverlay.style.display = 'block';
    
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    
    if (gameState === 'playing') {
        updateCat();
        updatePipes();
        updateObstacles();
        checkCollisions(); 
    }
    
    drawPipes();
    drawObstacles();
    drawCat();
    
    if (gameState === 'playing') {
        animationFrameId = requestAnimationFrame(gameLoop);
    }
}

function catJump() {
    cat.velocityY = cat.jumpStrength;
    playSound(jumpSoundBuffer);
}

function catDive() {
    cat.velocityY = cat.diveStrength;
}

// Toggle pause state
function togglePause() {
    if (gameState === 'playing' && score >= 15) {
        gameState = 'paused';
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        pauseOverlay.style.display = 'block';
    } else if (gameState === 'paused') {
        pauseOverlay.style.display = 'none';
        gameState = 'playing';
        // ensure we don't add an extra gravity step on resume
        skipGravityOnResume = true;
        gameLoop();
    }
}

// Pause button click
pauseButton.addEventListener('click', togglePause);

window.onload = async () => {
    canvas.width = 360; 
    canvas.height = 540; 

    cat.x = canvas.width / 4;
    cat.y = canvas.height / 2 - cat.height / 2;
    
    try {
        await loadAssets();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawBackground();
        drawCat();
        instructionsOverlay.style.display = 'block';
        scoreDisplayElement.textContent = `Điểm: 0`;
    } catch (error) {
        console.error("Failed to initialize game:", error);
        instructionsOverlay.innerHTML = "<p>Lỗi tải game. Vui lòng làm mới.</p>";
        instructionsOverlay.style.display = 'block';
    }
};

canvas.addEventListener('click', () => {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(e => console.error("Error resuming AudioContext on canvas click:", e));
    }
    if (gameState === 'start') {
        startGameFlow();
    } else if (gameState === 'playing') {
        catJump(); 
    }
});

restartButton.addEventListener('click', () => {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(e => console.error("Error resuming AudioContext on restart:", e));
    }
    startGameFlow(); 
});

window.addEventListener('keydown', function(e) {
    if (e.code === 'Enter') {
        e.preventDefault(); 
        if (gameState === 'start' || gameState === 'gameOver') {
            startGameFlow();
        } else if (gameState === 'playing' && score >= 15) {
            togglePause();
        } else if (gameState === 'paused') {
            togglePause();
        }
    } else if (e.code === 'ArrowUp') {
        e.preventDefault(); 
        if (gameState === 'playing') {
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume().catch(err => console.error("Error resuming AudioContext on ArrowUp:", err));
            }
            catJump();
        }
    } else if (e.code === 'ArrowDown') {
        e.preventDefault(); 
        if (gameState === 'playing') {
            catDive();
        }
    } else if (e.code === 'Space') {
        if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
             e.preventDefault();
        }
    }
});