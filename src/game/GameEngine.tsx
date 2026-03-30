import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  GRID_SIZE, 
  TILE_SIZE, 
  VIEWPORT_SIZE, 
  PLAYER_SPEED, 
  SEEKER_SPEED_PATROL, 
  SEEKER_SPEED_CHASE, 
  DETECTION_RADIUS, 
  DETECTION_RATE, 
  COOLDOWN_RATE,
  Point,
  Seeker,
  GameStatus
} from './types';
import { generateGrid, aStar, hasLineOfSight } from './utils';
import { Shield, Zap, AlertTriangle, Play, RefreshCcw, Trophy } from 'lucide-react';

const GameEngine: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  
  // Game State Refs (for high performance loop)
  const playerPosRef = useRef<Point>({ x: 1.5, y: 1.5 });
  const seekersRef = useRef<Seeker[]>([
    { 
      id: '1', 
      pos: { x: 25, y: 25 }, 
      target: null, 
      path: [], 
      state: 'PATROL', 
      lastKnownPlayerPos: null,
      patrolWaypoint: { x: 25, y: 25 }
    },
    { 
      id: '2', 
      pos: { x: 5, y: 25 }, 
      target: null, 
      path: [], 
      state: 'PATROL', 
      lastKnownPlayerPos: null,
      patrolWaypoint: { x: 5, y: 25 }
    },
    { 
      id: '3', 
      pos: { x: 25, y: 5 }, 
      target: null, 
      path: [], 
      state: 'PATROL', 
      lastKnownPlayerPos: null,
      patrolWaypoint: { x: 25, y: 5 }
    }
  ]);
  const gridRef = useRef<number[][]>(generateGrid());
  const keysPressed = useRef<Set<string>>(new Set());
  const detectionMeterRef = useRef<number>(0);
  const survivalTimeRef = useRef<number>(0);
  const statusRef = useRef<GameStatus>('HIDING');

  // React State (for UI)
  const [uiStatus, setUiStatus] = useState<GameStatus>('HIDING');
  const [uiSurvivalTime, setUiSurvivalTime] = useState(0);
  const [bestRecord, setBestRecord] = useState(0);
  const [isGameStarted, setIsGameStarted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('neon_shadows_best');
    if (saved) setBestRecord(parseFloat(saved));
  }, []);

  const resetGame = useCallback(() => {
    playerPosRef.current = { x: 1.5, y: 1.5 };
    gridRef.current = generateGrid();
    seekersRef.current = seekersRef.current.map(s => ({
      ...s,
      pos: { x: Math.floor(Math.random() * 20) + 10, y: Math.floor(Math.random() * 20) + 10 },
      state: 'PATROL',
      path: [],
      lastKnownPlayerPos: null
    }));
    detectionMeterRef.current = 0;
    survivalTimeRef.current = 0;
    statusRef.current = 'HIDING';
    setUiStatus('HIDING');
    setUiSurvivalTime(0);
    setIsGameStarted(true);
  }, []);

  const handleKeyDown = (e: KeyboardEvent) => keysPressed.current.add(e.key.toLowerCase());
  const handleKeyUp = (e: KeyboardEvent) => keysPressed.current.delete(e.key.toLowerCase());

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  const update = (delta: number) => {
    if (statusRef.current === 'CAUGHT') return;

    // 1. Player Movement
    let dx = 0;
    let dy = 0;
    if (keysPressed.current.has('w') || keysPressed.current.has('arrowup')) dy -= 1;
    if (keysPressed.current.has('s') || keysPressed.current.has('arrowdown')) dy += 1;
    if (keysPressed.current.has('a') || keysPressed.current.has('arrowleft')) dx -= 1;
    if (keysPressed.current.has('d') || keysPressed.current.has('arrowright')) dx += 1;

    if (dx !== 0 || dy !== 0) {
      const length = Math.sqrt(dx * dx + dy * dy);
      const moveX = (dx / length) * PLAYER_SPEED * (delta / 16.67);
      const moveY = (dy / length) * PLAYER_SPEED * (delta / 16.67);

      const nextX = playerPosRef.current.x + moveX / TILE_SIZE;
      const nextY = playerPosRef.current.y + moveY / TILE_SIZE;

      // Simple collision
      const gridX = Math.floor(nextX);
      const gridY = Math.floor(nextY);
      
      // Check boundaries and walls
      if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE) {
        if (gridRef.current[Math.floor(playerPosRef.current.y)][gridX] === 0) {
          playerPosRef.current.x = nextX;
        }
        if (gridRef.current[gridY][Math.floor(playerPosRef.current.x)] === 0) {
          playerPosRef.current.y = nextY;
        }
      }
    }

    // 2. Seeker Logic
    let anySpotted = false;
    seekersRef.current.forEach(seeker => {
      const canSee = hasLineOfSight(seeker.pos, playerPosRef.current, gridRef.current, DETECTION_RADIUS);
      
      if (canSee) {
        anySpotted = true;
        seeker.state = 'CHASE';
        seeker.lastKnownPlayerPos = { ...playerPosRef.current };
        
        // Recalculate path to player
        const start = { x: Math.floor(seeker.pos.x), y: Math.floor(seeker.pos.y) };
        const end = { x: Math.floor(playerPosRef.current.x), y: Math.floor(playerPosRef.current.y) };
        seeker.path = aStar(start, end, gridRef.current);
      } else if (seeker.state === 'CHASE') {
        // Continue to last known position
        if (seeker.path.length === 0) {
          seeker.state = 'PATROL';
          seeker.lastKnownPlayerPos = null;
        }
      } else {
        // Patrol logic
        if (seeker.path.length === 0) {
          const randomX = Math.floor(Math.random() * GRID_SIZE);
          const randomY = Math.floor(Math.random() * GRID_SIZE);
          if (gridRef.current[randomY][randomX] === 0) {
            seeker.patrolWaypoint = { x: randomX, y: randomY };
            seeker.path = aStar(
              { x: Math.floor(seeker.pos.x), y: Math.floor(seeker.pos.y) },
              seeker.patrolWaypoint,
              gridRef.current
            );
          }
        }
      }

      // Move seeker along path
      if (seeker.path.length > 0) {
        const nextNode = seeker.path[0];
        const targetX = nextNode.x + 0.5;
        const targetY = nextNode.y + 0.5;
        
        const sdx = targetX - seeker.pos.x;
        const sdy = targetY - seeker.pos.y;
        const dist = Math.sqrt(sdx * sdx + sdy * sdy);
        
        const speed = seeker.state === 'CHASE' ? SEEKER_SPEED_CHASE : SEEKER_SPEED_PATROL;
        const moveStep = (speed * (delta / 16.67)) / TILE_SIZE;

        if (dist < moveStep) {
          seeker.pos.x = targetX;
          seeker.pos.y = targetY;
          seeker.path.shift();
        } else {
          seeker.pos.x += (sdx / dist) * moveStep;
          seeker.pos.y += (sdy / dist) * moveStep;
        }
      }

      // Check for catch
      const distToPlayer = Math.sqrt(
        Math.pow(seeker.pos.x - playerPosRef.current.x, 2) + 
        Math.pow(seeker.pos.y - playerPosRef.current.y, 2)
      );
      if (distToPlayer < 0.8) {
        statusRef.current = 'CAUGHT';
        setUiStatus('CAUGHT');
        if (survivalTimeRef.current > bestRecord) {
          setBestRecord(survivalTimeRef.current);
          localStorage.setItem('neon_shadows_best', survivalTimeRef.current.toString());
        }
      }
    });

    // 3. Detection Meter
    if (anySpotted) {
      detectionMeterRef.current = Math.min(1, detectionMeterRef.current + DETECTION_RATE);
      statusRef.current = 'SPOTTED';
    } else {
      detectionMeterRef.current = Math.max(0, detectionMeterRef.current - COOLDOWN_RATE);
      if (detectionMeterRef.current === 0) statusRef.current = 'HIDING';
    }

    if (detectionMeterRef.current >= 1 && statusRef.current !== 'CAUGHT') {
      // Optional: make seekers faster or trigger alarm
    }

    survivalTimeRef.current += delta / 1000;
    setUiSurvivalTime(survivalTimeRef.current);
    setUiStatus(statusRef.current);
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Grid
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (gridRef.current[y][x] === 1) {
          ctx.fillStyle = '#1e1b4b'; // Dark indigo
          ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#a855f7'; // Neon purple
          ctx.lineWidth = 1;
          ctx.strokeRect(x * TILE_SIZE + 2, y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        } else {
          // Grid dots
          ctx.fillStyle = 'rgba(168, 85, 247, 0.1)';
          ctx.beginPath();
          ctx.arc(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Draw Seekers
    seekersRef.current.forEach(seeker => {
      // LoS Cone (visual only)
      if (seeker.state === 'CHASE') {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.1)';
        ctx.beginPath();
        ctx.arc(seeker.pos.x * TILE_SIZE, seeker.pos.y * TILE_SIZE, DETECTION_RADIUS * TILE_SIZE, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.shadowBlur = 15;
      ctx.shadowColor = seeker.state === 'CHASE' ? '#ef4444' : '#f59e0b';
      ctx.fillStyle = seeker.state === 'CHASE' ? '#ef4444' : '#f59e0b';
      ctx.beginPath();
      ctx.arc(seeker.pos.x * TILE_SIZE, seeker.pos.y * TILE_SIZE, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Eye icon
      ctx.fillStyle = 'white';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('👁', seeker.pos.x * TILE_SIZE, seeker.pos.y * TILE_SIZE + 4);
    });

    // Draw Player
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#06b6d4'; // Cyan
    ctx.fillStyle = '#06b6d4';
    ctx.beginPath();
    ctx.arc(playerPosRef.current.x * TILE_SIZE, playerPosRef.current.y * TILE_SIZE, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Fog of War (Radial Gradient Mask)
    const gradient = ctx.createRadialGradient(
      playerPosRef.current.x * TILE_SIZE,
      playerPosRef.current.y * TILE_SIZE,
      TILE_SIZE * 2,
      playerPosRef.current.x * TILE_SIZE,
      playerPosRef.current.y * TILE_SIZE,
      TILE_SIZE * 8
    );
    gradient.addColorStop(0, 'rgba(10, 10, 15, 0)');
    gradient.addColorStop(1, 'rgba(10, 10, 15, 0.95)');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const lastTimeRef = useRef<number>(0);
  const animate = (time: number) => {
    const delta = time - lastTimeRef.current;
    lastTimeRef.current = time;

    update(delta);
    draw();

    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    if (isGameStarted) {
      requestRef.current = requestAnimationFrame(animate);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isGameStarted]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative w-full h-screen bg-[#0a0a0f] text-white font-mono overflow-hidden flex items-center justify-center">
      {/* HUD Top Left */}
      <div className="absolute top-8 left-8 z-20 space-y-4">
        <div className="bg-black/40 backdrop-blur-md border border-white/10 p-4 rounded-lg">
          <div className="text-[10px] text-purple-400 uppercase tracking-widest mb-1">Survival_Time</div>
          <div className="text-4xl font-bold text-white tabular-nums">
            {formatTime(uiSurvivalTime).split(':')[0]}:{formatTime(uiSurvivalTime).split(':')[1]}
            <span className="text-pink-500 text-2xl">:{formatTime(uiSurvivalTime).split(':')[2]}</span>
          </div>
        </div>
        <div className="bg-black/40 backdrop-blur-md border border-white/10 p-4 rounded-lg">
          <div className="text-[10px] text-cyan-400 uppercase tracking-widest mb-1">Best_Record</div>
          <div className="text-xl font-bold text-white/80 tabular-nums">
            {formatTime(bestRecord)}
          </div>
        </div>
      </div>

      {/* HUD Top Right */}
      <div className="absolute top-8 right-8 z-20">
        <div className="w-48 h-48 bg-black/60 border border-white/10 rounded-lg overflow-hidden relative">
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            <div className="w-full h-full bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>
          </div>
          <div className="p-2 text-[8px] text-white/40 uppercase tracking-tighter border-b border-white/5">Locator_V4.2 // Node_77</div>
          <div className="relative w-full h-full p-4">
             {/* Mini Map */}
             <div className="w-full h-full relative border border-white/5">
                <div 
                  className="absolute w-1 h-1 bg-cyan-400 rounded-full shadow-[0_0_5px_cyan]"
                  style={{ 
                    left: `${(playerPosRef.current.x / GRID_SIZE) * 100}%`, 
                    top: `${(playerPosRef.current.y / GRID_SIZE) * 100}%` 
                  }}
                />
                {seekersRef.current.map(s => (
                  <div 
                    key={s.id}
                    className={`absolute w-1 h-1 rounded-full ${s.state === 'CHASE' ? 'bg-red-500 shadow-[0_0_5px_red]' : 'bg-amber-500'}`}
                    style={{ 
                      left: `${(s.pos.x / GRID_SIZE) * 100}%`, 
                      top: `${(s.pos.y / GRID_SIZE) * 100}%` 
                    }}
                  />
                ))}
             </div>
          </div>
        </div>
      </div>

      {/* Detection Meter Bottom Right */}
      <div className="absolute bottom-8 right-8 z-20 w-80">
        <div className="bg-black/40 backdrop-blur-md border border-white/10 p-4 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <div className="text-[10px] text-white/60 uppercase tracking-widest flex items-center gap-2">
              Detection Risk
              {uiStatus === 'SPOTTED' && <AlertTriangle size={12} className="text-red-500 animate-pulse" />}
            </div>
            <div className={`text-[10px] ${uiStatus === 'SPOTTED' ? 'text-red-500' : 'text-cyan-500'}`}>
              {Math.round(detectionMeterRef.current * 100)}%
            </div>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <motion.div 
              className={`h-full ${uiStatus === 'SPOTTED' ? 'bg-red-500' : 'bg-cyan-500'}`}
              animate={{ width: `${detectionMeterRef.current * 100}%` }}
              transition={{ type: 'spring', bounce: 0, duration: 0.2 }}
            />
          </div>
          <div className="mt-2 text-[8px] text-white/20 text-right uppercase">Warning: System_Compromised_72%</div>
        </div>
      </div>

      {/* Controls Bottom Left */}
      <div className="absolute bottom-8 left-8 z-20 flex items-center gap-6">
        <div className="grid grid-cols-3 gap-1">
          <div />
          <div className={`w-8 h-8 border border-white/20 rounded flex items-center justify-center text-[10px] ${keysPressed.current.has('w') ? 'bg-white/20' : ''}`}>W</div>
          <div />
          <div className={`w-8 h-8 border border-white/20 rounded flex items-center justify-center text-[10px] ${keysPressed.current.has('a') ? 'bg-white/20' : ''}`}>A</div>
          <div className={`w-8 h-8 border border-white/20 rounded flex items-center justify-center text-[10px] ${keysPressed.current.has('s') ? 'bg-white/20' : ''}`}>S</div>
          <div className={`w-8 h-8 border border-white/20 rounded flex items-center justify-center text-[10px] ${keysPressed.current.has('d') ? 'bg-white/20' : ''}`}>D</div>
        </div>
        <div className="text-[10px] text-white/40 leading-relaxed">
          MOVEMENT SEQUENCE<br/>ALPHA_PROTOCOL
        </div>
      </div>

      {/* Main Game Canvas */}
      <div className="relative border border-white/10 shadow-[0_0_50px_rgba(168,85,247,0.1)]">
        <canvas 
          ref={canvasRef}
          width={VIEWPORT_SIZE}
          height={VIEWPORT_SIZE}
          className="bg-[#0a0a0f]"
        />
        
        {/* Scanline Effect */}
        <div className="absolute inset-0 pointer-events-none opacity-10 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />
      </div>

      {/* Overlays */}
      <AnimatePresence>
        {!isGameStarted && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/80 backdrop-blur-xl flex flex-center items-center justify-center"
          >
            <div className="text-center space-y-8 max-w-md px-8">
              <motion.h1 
                initial={{ y: 20 }}
                animate={{ y: 0 }}
                className="text-6xl font-black tracking-tighter italic text-transparent bg-clip-text bg-gradient-to-br from-white to-white/20"
              >
                NEON SHADOWS
              </motion.h1>
              <p className="text-white/40 text-sm leading-relaxed">
                The Labyrinth is active. Seekers are deployed. 
                Stay out of the light. Survive the protocol.
              </p>
              <button 
                onClick={resetGame}
                className="group relative px-12 py-4 bg-white text-black font-bold uppercase tracking-widest overflow-hidden transition-transform active:scale-95"
              >
                <div className="absolute inset-0 bg-cyan-400 translate-x-full group-hover:translate-x-0 transition-transform duration-300" />
                <span className="relative z-10 flex items-center justify-center gap-2">
                  Initialize_Protocol <Play size={16} fill="currentColor" />
                </span>
              </button>
            </div>
          </motion.div>
        )}

        {uiStatus === 'CAUGHT' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-50 bg-red-950/90 backdrop-blur-xl flex items-center justify-center"
          >
            <div className="text-center space-y-8">
              <div className="space-y-2">
                <h2 className="text-8xl font-black text-red-500 tracking-tighter italic">CAUGHT</h2>
                <p className="text-red-200/40 text-sm uppercase tracking-widest">Subject_Terminated // Connection_Lost</p>
              </div>
              
              <div className="bg-black/40 p-8 rounded-2xl border border-red-500/20 inline-block">
                <div className="text-red-400 text-[10px] uppercase mb-4">Final_Data_Log</div>
                <div className="flex gap-12">
                  <div>
                    <div className="text-white/40 text-[10px] mb-1">SURVIVAL</div>
                    <div className="text-3xl font-bold">{formatTime(uiSurvivalTime)}</div>
                  </div>
                  <div>
                    <div className="text-white/40 text-[10px] mb-1">BEST</div>
                    <div className="text-3xl font-bold text-cyan-400">{formatTime(bestRecord)}</div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center gap-4">
                <button 
                  onClick={resetGame}
                  className="px-8 py-3 bg-red-500 text-white font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-red-400 transition-colors"
                >
                  Retry_Sequence <RefreshCcw size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      <div className="absolute bottom-4 w-full px-8 flex justify-between text-[8px] text-white/10 uppercase tracking-widest">
        <div className="flex gap-4">
          <span className="flex items-center gap-1"><div className="w-1 h-1 bg-green-500 rounded-full" /> Engine: Active</span>
          <span className="flex items-center gap-1"><div className="w-1 h-1 bg-green-500 rounded-full" /> Latency: 14ms</span>
          <span className="flex items-center gap-1"><div className="w-1 h-1 bg-purple-500 rounded-full" /> Recording_Session...</span>
        </div>
        <div>Ghost_Unit_01 // © 2144 Neon_Shadows_Labs // V2.0.4-Beta</div>
      </div>
    </div>
  );
};

export default GameEngine;
