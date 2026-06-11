/** 
 * GLOBALS & CONFIG
 */
const videoElement = document.querySelector('.input_video');
const bgCanvas = document.getElementById('bgCanvas');
const mainCanvas = document.getElementById('mainCanvas');
const bgCtx = bgCanvas.getContext('2d');
const ctx = mainCanvas.getContext('2d');

let width = window.innerWidth;
let height = window.innerHeight;

let time = 0;
let lastTime = performance.now();
let framesThisSecond = 0;
let lastFpsTime = performance.now();

const TWO_PI = Math.PI * 2;
let isModelLoaded = false;

let currentHands = []; // Latest data from MediaPipe
let handVelocities = 0; // Average hand movement speed

// Theme Config
let currentTheme = 'Rainbow';
const themes = {
    'Rainbow':   (t, index, total) => `hsl(${(t * 100 + index * (360/total)) % 360}, 100%, 60%)`,
    'Cyberpunk': (t, index, total) => (index % 2 === 0) ? '#ff003c' : '#00f0ff',
    'Lava':      (t, index, total) => `hsl(${(10 + (index * 10)) % 40}, 100%, ${50 + Math.sin(t)*10}%)`,
    'Ocean':     (t, index, total) => `hsl(${180 + (index * 20)}, 100%, 60%)`,
    'Galaxy':    (t, index, total) => `hsl(${260 + Math.sin(t*2 + index)*40}, 100%, 65%)`
};

// Physics Engines Data
let particles = [];
let ripples = [];
const FINGER_TIPS = [4, 8, 12, 16, 20];

// Matrix Background
let matrixColumns = [];
const fontSize = 16;
let maxColumns = 0;

// Audio Node References
let audioCtx = null;
let humOsc = null;
let humGain = null;

// UI Elements
const uiHands = document.getElementById('ui-hands');
const uiFps = document.getElementById('ui-fps');
const uiGesture = document.getElementById('ui-gesture');
const uiSpread = document.getElementById('ui-spread');

/**
 * INITIALIZATION
 */
function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    bgCanvas.width = width;
    bgCanvas.height = height;
    mainCanvas.width = width;
    mainCanvas.height = height;
    
    maxColumns = Math.floor(width / fontSize);
    matrixColumns = new Array(maxColumns).fill(1).map(() => Math.random() * height/fontSize);
    bgCtx.font = `${fontSize}px monospace`;
}
window.addEventListener('resize', resize);
resize();

// UI Theme Switcher
document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentTheme = e.target.getAttribute('data-theme');
        document.documentElement.style.setProperty('--accent', themes[currentTheme](0, 1, 1));
    });
});

// Start button triggers AudioContext and hides overlay
document.getElementById('startBtn').addEventListener('click', () => {
    document.getElementById('startBtn').classList.add('hidden');
    const overlayText = document.getElementById('overlayText');
    overlayText.innerText = "Loading AI Models... Please wait.";
    overlayText.classList.add('loading-pulse');
    initAudio();
    initMediaPipe();
});


/**
 * AUDIO ENGINE
 */
function initAudio() {
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Continuous Hum
        humOsc = audioCtx.createOscillator();
        humGain = audioCtx.createGain();
        
        humOsc.type = 'sine';
        humOsc.frequency.value = 100;
        
        humGain.gain.value = 0; // Mute until hands are seen
        
        humOsc.connect(humGain);
        humGain.connect(audioCtx.destination);
        humOsc.start();
    } catch(e) {
        console.error("Web Audio API failed", e);
    }
}

function triggerZap() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    // Zap sound profile
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
    
    osc.onended = () => {
        osc.disconnect();
        gainNode.disconnect();
    };
}

const DRUM_ZONES = [
    { id: 'kick', x: 0.1, y: 0.6, w: 0.2, h: 0.3, color: 'rgba(255, 50, 50, 0.3)' },
    { id: 'snare', x: 0.7, y: 0.6, w: 0.2, h: 0.3, color: 'rgba(50, 255, 50, 0.3)' },
    { id: 'hihat', x: 0.1, y: 0.2, w: 0.2, h: 0.2, color: 'rgba(50, 50, 255, 0.3)' }
];

function playDrum(type) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    if (type === 'kick') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(0.01, t + 0.5);
        gain.gain.setValueAtTime(1, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
        osc.start(t);
        osc.stop(t + 0.5);
    } else if (type === 'snare') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(250, t);
        gain.gain.setValueAtTime(1, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
        osc.start(t);
        osc.stop(t + 0.2);
    } else if (type === 'hihat') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(8000, t);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.1);
    }
}

function updateHum(activeHands) {
    if (!audioCtx || !humGain) return;
    if (activeHands.length < 2) {
        humGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        return;
    }

    // Virtual Theremin: 
    // Hand 0 configures the pitch based on Y axis.
    // Hand 1 configures the volume based on Y axis.
    const h1 = activeHands[0][8]; // Index finger tip of rightmost hand (due to mirror)
    const h2 = activeHands[1][8]; // Index finger tip of leftmost hand
    
    // Y values: 0 is top of screen, 1 is bottom
    // Pitch Hand (h1) mapping: higher physical position (lower Y) -> higher pitch
    const targetFreq = 100 + (1 - Math.min(Math.max(h1.y, 0), 1)) * 900;
    
    // Volume Hand (h2) mapping: higher physical position (lower Y) -> louder
    const targetVolume = (1 - Math.min(Math.max(h2.y, 0), 1)) * 0.5;
    
    humOsc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.1);
    humGain.gain.setTargetAtTime(targetVolume, audioCtx.currentTime, 0.1);
}

/**
 * MATH & STATE LOGIC
 */
function getDist(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// Convert normalized landmark to specific canvas scale (Note: canvas is horizontally flipped)
function mapToCanvas(point) {
    return { x: point.x * width, y: point.y * height };
}

let lastPinchState = [false, false]; // Prevents rapid re-triggering
let previousHands = []; // For drum zone hit detection

function detectGestures() {
    if (!currentHands || currentHands.length === 0) {
        uiGesture.innerText = "No Hand Detected ðŸ›‘";
        uiSpread.innerText = "0%";
        previousHands = [];
        return;
    }
    
    // Drum Zone Hit Detection
    for (let i = 0; i < currentHands.length; i++) {
        if (!previousHands[i]) continue;
        
        let currPt = currentHands[i][8]; // index finger
        let prevPt = previousHands[i][8];
        
        for (let zone of DRUM_ZONES) {
            let wasInZone = (prevPt.x >= zone.x && prevPt.x <= zone.x + zone.w && prevPt.y >= zone.y && prevPt.y <= zone.y + zone.h);
            let isInZone = (currPt.x >= zone.x && currPt.x <= zone.x + zone.w && currPt.y >= zone.y && currPt.y <= zone.y + zone.h);
            
            // Trigger when moving INTO the zone
            if (!wasInZone && isInZone) {
                playDrum(zone.id);
                createShockwave(mapToCanvas(currPt), '#ffffff');
            }
        }
    }
    
    currentHands.forEach((hand, idx) => {
        // Pinch Detection: Thumb (4) and Index (8)
        const thumb = hand[4];
        const index = hand[8];
        const dist = getDist(thumb, index);
        
        const isPinching = dist < 0.05; // 5% of screen screen distance
        
        if (isPinching && !lastPinchState[idx]) {
            const midpoint = {
                x: (thumb.x + index.x) / 2, 
                y: (thumb.y + index.y) / 2
            };
            createShockwave(mapToCanvas(midpoint), themes[currentTheme](time, 1, 1));
            triggerZap();
        }
        lastPinchState[idx] = isPinching;

        // Improved Advanced Gesture Recognition using finger states and positional data
        // Check if tips are further from wrist (0) than the PIP joints
        const fingers = {
            thumb: getDist(hand[4], hand[17]) > getDist(hand[3], hand[17]) * 1.1,
            index: getDist(hand[8], hand[0]) > getDist(hand[6], hand[0]) * 1.1,
            middle: getDist(hand[12], hand[0]) > getDist(hand[10], hand[0]) * 1.1,
            ring: getDist(hand[16], hand[0]) > getDist(hand[14], hand[0]) * 1.1,
            pinky: getDist(hand[20], hand[0]) > getDist(hand[18], hand[0]) * 1.1
        };

        // Get relative vertical position for directional gestures (like Thumbs Up/Down)
        const isThumbUp = hand[4].y < hand[3].y && hand[4].y < hand[2].y;
        const isThumbDown = hand[4].y > hand[3].y && hand[4].y > hand[2].y;

        let detectedGesture = "None";

        // Positive & Social
        if (fingers.thumb && !fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
            detectedGesture = isThumbDown ? "Thumbs Down ðŸ‘Ž" : "Thumbs Up ðŸ‘";
        } else if (dist < 0.05 && fingers.middle && fingers.ring && fingers.pinky) { // Index and Thumb pinching, others up
            detectedGesture = "OK Sign ðŸ‘Œ";
        } else if (!fingers.thumb && fingers.index && fingers.middle && !fingers.ring && !fingers.pinky) {
            detectedGesture = "Peace / V-Sign âœŒï¸";
        } else if (fingers.thumb && fingers.index && !fingers.middle && !fingers.ring && fingers.pinky) {
            detectedGesture = "I Love You Sign ðŸ¤Ÿ";
        } else if (fingers.thumb && !fingers.index && !fingers.middle && !fingers.ring && fingers.pinky) {
            detectedGesture = "Shaka / Hang Loose ðŸ¤™";
        } else if (!fingers.thumb && fingers.index && !fingers.middle && !fingers.ring && fingers.pinky) {
            detectedGesture = "Sign of the Horns ðŸ¤˜";
        } else if (!fingers.thumb && fingers.index && fingers.middle && !fingers.ring && fingers.pinky) {
            // Index, middle, pinky extended? Wait, rock on is index + pinky.
        } else if (fingers.thumb && fingers.index && fingers.middle && fingers.ring && fingers.pinky) {
            // Could be High Five, Palm Flash, or Hand Waving. Default to Palm / Stop
            detectedGesture = "High Five / Palm ðŸ–ï¸";
        } else if (!fingers.thumb && !fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
            detectedGesture = "Fist / Fist Bump âœŠ";
        } else if (fingers.index && !fingers.thumb && !fingers.middle && !fingers.ring && !fingers.pinky) {
            detectedGesture = "Pointing â˜ï¸";
        } else if (fingers.middle && !fingers.thumb && !fingers.index && !fingers.ring && !fingers.pinky) {
            detectedGesture = "The Middle Finger ðŸ–•";
        } else if (fingers.thumb && fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
            // L-shape with thumb and index
            // If the thumb is roughly horizontal and index is vertical, it's a Loser sign or Guns up
            detectedGesture = "Loser Sign / Guns Up ðŸ‘†";
        } else if (!fingers.thumb && fingers.index && fingers.middle && fingers.ring && !fingers.pinky) {
            detectedGesture = "Scout Sign ðŸ•ï¸";
        } else if (isPinching && !fingers.middle && !fingers.ring && !fingers.pinky) {
            detectedGesture = "Pinched Fingers ðŸ¤ / Chef's Kiss";
        } else if (fingers.index && fingers.middle && fingers.ring && fingers.pinky && !fingers.thumb) {
            detectedGesture = "Four Fingers / Vulcan Salute ðŸ––"; // Actual Vulcan needs gap tracking
        }

        // Two-handed gestures check
        if (currentHands.length === 2 && idx === 0) {
            const h1 = currentHands[0];
            const h2 = currentHands[1];
            
            // Check if palms are close to each other (Namaste / Applause / Heart)
            const wristDist = getDist(h1[0], h2[0]);
            if (wristDist < 0.2) {
                detectedGesture = "Namaste / Clapping ðŸ™";
            }
        }

        // Only update the main UI hud for the first (primary) hand
        if (idx === 0) {
            uiGesture.innerText = detectedGesture;
            
            // Spread Percentage roughly estimated by distance from Index(8) and Pinky(20)
            const spread = getDist(hand[8], hand[20]);
            let spreadPct = Math.min(Math.round(spread * 300), 100);
            uiSpread.innerText = spreadPct + '%';
        }
    });

    // Store hands for next frame's drum hit detection
    previousHands = currentHands.map(hand => JSON.parse(JSON.stringify(hand)));
}

/**
 * EFFECTS & PHYSICS
 */
function createParticles(pos, color, count = 3) {
    for (let i=0; i<count; i++) {
        particles.push({
            x: pos.x,
            y: pos.y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            life: 1.0,
            color: color,
            size: Math.random() * 3 + 1
        });
    }
}

function createShockwave(pos, color) {
    ripples.push({
        x: pos.x,
        y: pos.y,
        radius: 0,
        maxRadius: 150 + Math.random() * 100,
        life: 1.0,
        color: color
    });
}

// Background Effect Engine
function drawBackground() {
    // Use destination-out to fade out the previous frame's drops, leaving a transparent trail
    bgCtx.globalCompositeOperation = 'destination-out';
    bgCtx.fillStyle = `rgba(0, 0, 0, ${0.15 + Math.min(handVelocities*10, 0.5)})`;
    bgCtx.fillRect(0, 0, width, height);
    bgCtx.globalCompositeOperation = 'source-over';

    // Matrix Rain Effect mapping to hand speed
    bgCtx.fillStyle = themes[currentTheme](time, 1, 1);
    
    // Matrix speed boosts when hands move fast
    let speedMult = 1 + (handVelocities * 100);

    for (let i = 0; i < matrixColumns.length; i++) {
        // Only draw randomly to keep it sparse like stars/rain
        if (Math.random() > 0.95) {
            const char = String.fromCharCode(0x30A0 + Math.random() * 96);
            bgCtx.fillText(char, i * fontSize, matrixColumns[i] * fontSize);
        }
        
        matrixColumns[i] += Math.random() * speedMult;
        
        if (matrixColumns[i] * fontSize > height && Math.random() > 0.9) {
            matrixColumns[i] = 0;
        }
    }
}

function updatePhysics() {
    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;     // Fade out
        p.vy += 0.1;        // Gravity
        
        if (p.life <= 0) {
            particles.splice(i, 1);
        } else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, TWO_PI);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.life;
            ctx.fill();
        }
    }
    
    // Ripples / Shockwaves
    for (let i = ripples.length - 1; i >= 0; i--) {
        let r = ripples[i];
        r.radius += (r.maxRadius - r.radius) * 0.1; // Ease out
        r.life -= 0.03;
        
        if (r.life <= 0) {
            ripples.splice(i, 1);
        } else {
            ctx.beginPath();
            ctx.arc(r.x, r.y, r.radius, 0, TWO_PI);
            ctx.strokeStyle = r.color;
            ctx.lineWidth = 4 * r.life;
            ctx.globalAlpha = r.life;
            ctx.stroke();
        }
    }
    ctx.globalAlpha = 1.0; // Reset
}

/**
 * MAIN RENDER PIPELINE
 */
function renderLoop(timestamp) {
    requestAnimationFrame(renderLoop);
    
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    time += dt;

    // Update FPS Counter
    framesThisSecond++;
    if (timestamp > lastFpsTime + 1000) {
        uiFps.innerText = framesThisSecond;
        framesThisSecond = 0;
        lastFpsTime = timestamp;
    }

    drawBackground();

    // The main canvas will clear fully each frame since we handle ghosting via bgCanvas 
    // BUT user requested trailing motion blur for fingertips.
    // Instead of clearRect, we fade the main canvas using destination-out to keep it transparent
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, width, height);

    // Enable Screen mode for additive light effects (like neon bloom)
    ctx.globalCompositeOperation = 'screen'; // Creates glowy overlapping effects

    // Render Drum Zones (Invisible / Very Faint)
    ctx.globalCompositeOperation = 'source-over';
    DRUM_ZONES.forEach(zone => {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.strokeRect(zone.x * width, zone.y * height, zone.w * width, zone.h * height);
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.font = '12px Orbitron';
        ctx.fillText(zone.id.toUpperCase() + " ZONE", zone.x * width + 5, zone.y * height + 15);
    });
    ctx.globalCompositeOperation = 'screen'; 

    // Render Physics layer
    updatePhysics();

    // Process Hand Logic if present
    if (currentHands.length > 0) {
        
        // 1. Draw Skeleton
        currentHands.forEach((hand, handIndex) => {
            const glowColor = themes[currentTheme](time, handIndex, 2);
            
            // Draw MediaPipe skeleton connectors using custom styles
            drawConnectors(ctx, hand, HAND_CONNECTIONS, {
                color: glowColor,
                lineWidth: 2
            });
            
            // Draw Landmarks with neon bloom
            ctx.shadowBlur = 15;
            ctx.shadowColor = glowColor;
            
            // Only draw fingertips with intense bloom and spawn particles
            FINGER_TIPS.forEach((tipIndex, idx) => {
                const pt = mapToCanvas(hand[tipIndex]);
                const tipCol = themes[currentTheme](time, idx, FINGER_TIPS.length);
                
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 4, 0, TWO_PI);
                ctx.fillStyle = '#fff';
                ctx.fill();

                // Generate constant spark particles at fingertips
                if (Math.random() > 0.6) {
                    createParticles(pt, tipCol, 1);
                }
            });
            ctx.shadowBlur = 0; // Reset
        });

        // 2. Cross-Hand Interactions (Lightning & Gradients)
        if (currentHands.length >= 2) {
            const h1 = currentHands[0];
            const h2 = currentHands[1];

            // A. Rainbow Connecting Lines
            FINGER_TIPS.forEach((tipIndex, idx) => {
                const pt1 = mapToCanvas(h1[tipIndex]);
                const pt2 = mapToCanvas(h2[tipIndex]);
                const dist = getDist(pt1, pt2);
                
                const col = themes[currentTheme](time, idx, FINGER_TIPS.length);
                
                // Lightning electric arc when very close (but not touching)
                if (dist < 150 && Math.random() > 0.5) {
                    // Draw jagged lightning
                    ctx.beginPath();
                    ctx.moveTo(pt1.x, pt1.y);
                    // Midpoint jitter
                    const midX = (pt1.x + pt2.x)/2 + (Math.random() - 0.5) * 50;
                    const midY = (pt1.y + pt2.y)/2 + (Math.random() - 0.5) * 50;
                    ctx.lineTo(midX, midY);
                    ctx.lineTo(pt2.x, pt2.y);
                    
                    ctx.strokeStyle = '#ffffff';
                    ctx.shadowBlur = 20;
                    ctx.shadowColor = col;
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }

                // Normal flowing gradient line
                ctx.beginPath();
                ctx.moveTo(pt1.x, pt1.y);
                ctx.lineTo(pt2.x, pt2.y);
                
                // Create gradient that shifts over time
                let grad = ctx.createLinearGradient(pt1.x, pt1.y, pt2.x, pt2.y);
                grad.addColorStop(0, themes[currentTheme](time, idx, 5));
                grad.addColorStop(0.5, themes[currentTheme](time, idx + 1, 5));
                grad.addColorStop(1, themes[currentTheme](time, idx + 2, 5));
                
                ctx.strokeStyle = grad;
                ctx.lineWidth = 4;
                ctx.shadowBlur = 10;
                ctx.shadowColor = col;
                ctx.stroke();
                ctx.shadowBlur = 0;
            });

            // B. Mandala drawing if 10 tips are perfectly detected
            // (Assuming if we have 2 hands, we draw lines connecting all tips in a star)
            // Combine all 10 tips
            let allTips = FINGER_TIPS.map(t => mapToCanvas(h1[t])).concat(
                          FINGER_TIPS.map(t => mapToCanvas(h2[t])) );
            
            ctx.save();
            // Find center point to draw Mandala
                let cx = allTips.reduce((sum, p) => sum + p.x, 0) / 10;
                let cy = allTips.reduce((sum, p) => sum + p.y, 0) / 10;
                
                ctx.translate(cx, cy);
                ctx.rotate(time * 0.5); // Slow rotation
                
                ctx.beginPath();
                for (let i=0; i<10; i++) {
                    const t1 = { x: allTips[i].x - cx, y: allTips[i].y - cy };
                    const t2 = { x: allTips[(i+3)%10].x - cx, y: allTips[(i+3)%10].y - cy };
                    ctx.moveTo(t1.x, t1.y);
                    ctx.lineTo(t2.x, t2.y);
                }
                ctx.strokeStyle = `rgba(255, 255, 255, 0.2)`;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();
        }
        
        detectGestures();
    }
    
    ctx.globalCompositeOperation = 'source-over'; // Restore
}

/**
 * MEDIAPIPE INITIALIZATION
 */
function initMediaPipe() {
    const hands = new Hands({locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }});

    hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1, 
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
    });

    hands.onResults((results) => {
        if (!audioCtx) return; // Wait for initialization

        if (!isModelLoaded) {
            isModelLoaded = true;
            document.getElementById('startOverlay').classList.add('hidden');
            document.getElementById('hud').classList.remove('hidden');
            document.getElementById('themes').classList.remove('hidden');
            requestAnimationFrame(renderLoop);
        }

        // Update global state for render loop to read from
        uiHands.innerText = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;
        
        // Calculate velocity (rudimentary)
        if (currentHands.length > 0 && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            let vSum = 0;
            // check distance difference on index finger of hand 0 
            const oldP = currentHands[0][8];
            const newP = results.multiHandLandmarks[0][8];
            if (oldP && newP) {
                vSum = getDist(oldP, newP);
            }
            handVelocities += ((vSum * 5.0) - handVelocities) * 0.2; 
        } else {
            handVelocities += (0 - handVelocities) * 0.2;
        }

        currentHands = results.multiHandLandmarks || [];
        updateHum(currentHands);
    });

    const camera = new Camera(videoElement, {
        onFrame: async () => {
            await hands.send({image: videoElement});
        },
        width: 1280,
        height: 720,
        facingMode: 'user'
    });
    
    camera.start().catch((err) => {
        console.error("Camera access denied or unavailable", err);
        document.getElementById('overlayText').innerText = "Error: Camera access denied or unavailable. Please enable permissions.";
        document.getElementById('startBtn').classList.remove('hidden');
    });
}
