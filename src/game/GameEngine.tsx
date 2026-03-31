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
  GameStatus,
  LeaderboardEntry
} from './types';
import { generateGrid, aStar, hasLineOfSight, getVisibilityPolygon } from './utils';
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
  const spawnTimerRef = useRef<number>(0);
  const spawnCornerIndexRef = useRef<number>(0);

  // React State (for UI)
  const [uiStatus, setUiStatus] = useState<GameStatus>('HIDING');
  const [uiSurvivalTime, setUiSurvivalTime] = useState(0);
  const [bestRecord, setBestRecord] = useState(0);
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isScoreSaved, setIsScoreSaved] = useState(false);
  const [showLeaderboardOnGameOver, setShowLeaderboardOnGameOver] = useState(false);

  useEffect(() => {
    const savedBest = localStorage.getItem('neon_shadows_best');
    if (savedBest) setBestRecord(parseFloat(savedBest));
    
    const savedLeaderboard = localStorage.getItem('neon_shadows_leaderboard');
    if (savedLeaderboard) setLeaderboard(JSON.parse(savedLeaderboard));
  }, []);

  const saveToLeaderboard = () => {
    if (!playerName.trim()) return;
    const newEntry: LeaderboardEntry = {
      name: playerName.trim(),
      time: survivalTimeRef.current,
      date: new Date().toLocaleDateString()
    };
    const newLeaderboard = [...leaderboard, newEntry]
      .sort((a, b) => b.time - a.time)
      .slice(0, 10);
    setLeaderboard(newLeaderboard);
    localStorage.setItem('neon_shadows_leaderboard', JSON.stringify(newLeaderboard));
    setIsScoreSaved(true);
  };

  const resetGame = useCallback(() => {
    playerPosRef.current = { x: 1.5, y: 1.5 };
    gridRef.current = generateGrid();
    seekersRef.current = [
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
      }
    ];
    detectionMeterRef.current = 0;
    survivalTimeRef.current = 0;
    spawnTimerRef.current = 0;
    spawnCornerIndexRef.current = 0;
    statusRef.current = 'HIDING';
    setUiStatus('HIDING');
    setUiSurvivalTime(0);
    setIsGameStarted(true);
    setIsScoreSaved(false);
    setShowLeaderboardOnGameOver(false);
  }, [leaderboard]);

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

  const spawnSeeker = () => {
    const corners = [
      { x: 0.5, y: 0.5 },
      { x: GRID_SIZE - 0.5, y: 0.5 },
      { x: GRID_SIZE - 0.5, y: GRID_SIZE - 0.5 },
      { x: 0.5, y: GRID_SIZE - 0.5 }
    ];
    const corner = corners[spawnCornerIndexRef.current % corners.length];
    spawnCornerIndexRef.current++;

    const newSeeker: Seeker = {
      id: Date.now().toString(),
      pos: { ...corner },
      target: null,
      path: [],
      state: 'PATROL',
      lastKnownPlayerPos: null,
      patrolWaypoint: { ...corner }
    };
    seekersRef.current.push(newSeeker);
  };

  const backToMenu = () => {
    setIsGameStarted(false);
    setUiStatus('HIDING');
    statusRef.current = 'HIDING';
    setShowLeaderboardOnGameOver(false);
  };

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
      
      const speed = seeker.state === 'CHASE' ? SEEKER_SPEED_CHASE : SEEKER_SPEED_PATROL;
      const moveStep = (speed * (delta / 16.67)) / TILE_SIZE;

      if (canSee) {
        anySpotted = true;
        seeker.state = 'CHASE';
        seeker.lastKnownPlayerPos = { ...playerPosRef.current };
        
        // When in LoS, move directly towards the player for smoothness
        const sdx = playerPosRef.current.x - seeker.pos.x;
        const sdy = playerPosRef.current.y - seeker.pos.y;
        const dist = Math.sqrt(sdx * sdx + sdy * sdy);
        
        if (dist > 0.1) {
          seeker.pos.x += (sdx / dist) * moveStep;
          seeker.pos.y += (sdy / dist) * moveStep;
        }
        // Clear path as we are moving directly
        seeker.path = [];
      } else if (seeker.state === 'CHASE') {
        // LoS lost, move to last known position using A*
        if (seeker.path.length === 0 && seeker.lastKnownPlayerPos) {
          const start = { x: Math.floor(seeker.pos.x), y: Math.floor(seeker.pos.y) };
          const end = { x: Math.floor(seeker.lastKnownPlayerPos.x), y: Math.floor(seeker.lastKnownPlayerPos.y) };
          seeker.path = aStar(start, end, gridRef.current);
          seeker.lastKnownPlayerPos = null; // Target reached or path calculated
        }

        if (seeker.path.length > 0) {
          const nextNode = seeker.path[0];
          const targetX = nextNode.x + 0.5;
          const targetY = nextNode.y + 0.5;
          
          const sdx = targetX - seeker.pos.x;
          const sdy = targetY - seeker.pos.y;
          const dist = Math.sqrt(sdx * sdx + sdy * sdy);
          
          if (dist < moveStep) {
            seeker.pos.x = targetX;
            seeker.pos.y = targetY;
            seeker.path.shift();
          } else {
            seeker.pos.x += (sdx / dist) * moveStep;
            seeker.pos.y += (sdy / dist) * moveStep;
          }
        } else {
          // Reached last known position, go back to patrol
          seeker.state = 'PATROL';
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

        if (seeker.path.length > 0) {
          const nextNode = seeker.path[0];
          const targetX = nextNode.x + 0.5;
          const targetY = nextNode.y + 0.5;
          
          const sdx = targetX - seeker.pos.x;
          const sdy = targetY - seeker.pos.y;
          const dist = Math.sqrt(sdx * sdx + sdy * sdy);
          
          if (dist < moveStep) {
            seeker.pos.x = targetX;
            seeker.pos.y = targetY;
            seeker.path.shift();
          } else {
            seeker.pos.x += (sdx / dist) * moveStep;
            seeker.pos.y += (sdy / dist) * moveStep;
          }
        }
      }

      // Check for catch (collision)
      const distToPlayer = Math.sqrt(
        Math.pow(seeker.pos.x - playerPosRef.current.x, 2) + 
        Math.pow(seeker.pos.y - playerPosRef.current.y, 2)
      );
      if (distToPlayer < 0.6) {
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
      statusRef.current = 'CAUGHT';
      setUiStatus('CAUGHT');
      if (survivalTimeRef.current > bestRecord) {
        setBestRecord(survivalTimeRef.current);
        localStorage.setItem('neon_shadows_best', survivalTimeRef.current.toString());
      }
    }

    // 4. Spawning Logic
    spawnTimerRef.current += delta / 1000;
    if (spawnTimerRef.current >= 10) {
      spawnTimerRef.current = 0;
      spawnSeeker();
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
      // LoS Cone (visual only) - Now respects walls
      if (seeker.state === 'CHASE') {
        const poly = getVisibilityPolygon(seeker.pos, gridRef.current, DETECTION_RADIUS);
        if (poly.length > 0) {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
          ctx.beginPath();
          ctx.moveTo(seeker.pos.x * TILE_SIZE, seeker.pos.y * TILE_SIZE);
          poly.forEach(p => {
            ctx.lineTo(p.x * TILE_SIZE, p.y * TILE_SIZE);
          });
          ctx.closePath();
          ctx.fill();
          
          // Add a subtle glow to the edge
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
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
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
    
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
    <div className="relative w-full h-screen bg-black text-white font-mono overflow-hidden flex items-center justify-center">
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
      <div className="relative border border-white/10 shadow-[0_0_50px_rgba(168,85,247,0.05)]">
        <canvas 
          ref={canvasRef}
          width={VIEWPORT_SIZE}
          height={VIEWPORT_SIZE}
          className="bg-black"
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
            className="absolute inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center"
          >
            <div className="flex flex-col md:flex-row gap-12 items-center max-w-6xl px-8">
              <div className="text-center md:text-left space-y-8 max-w-md">
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
                  <br/><br/>
                  <span className="text-cyan-400">NEW INTEL:</span> A new seeker spawns every 10 seconds. 
                  Full detection triggers immediate termination.
                  Seekers move faster when they spot you.
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

              {/* Leaderboard */}
              <div className="w-80 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md">
                <div className="flex items-center gap-2 mb-6 text-cyan-400">
                  <Trophy size={18} />
                  <span className="text-xs font-bold uppercase tracking-widest">Global_Leaderboard</span>
                </div>
                <div className="space-y-3">
                  {leaderboard.length > 0 ? (
                    leaderboard.map((entry, i) => (
                      <div key={i} className="flex justify-between items-center text-[10px] border-b border-white/5 pb-2">
                        <div className="flex gap-3">
                          <span className="text-white/20">0{i + 1}</span>
                          <span className="text-white/80 font-bold">{entry.name}</span>
                        </div>
                        <span className="text-cyan-400">{formatTime(entry.time)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-[10px] text-white/20 text-center py-8 italic">No data logs found...</div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {uiStatus === 'CAUGHT' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`absolute inset-0 z-50 ${showLeaderboardOnGameOver ? 'bg-cyan-950/90' : 'bg-red-950/90'} backdrop-blur-xl flex items-center justify-center transition-colors duration-500`}
          >
            <div className="text-center space-y-8 max-w-xl px-8 w-full">
              <div className="space-y-2">
                <h2 className={`text-8xl font-black ${showLeaderboardOnGameOver ? 'text-cyan-500' : 'text-red-500'} tracking-tighter italic transition-colors duration-500`}>
                  {showLeaderboardOnGameOver ? 'LEADERBOARD' : 'TERMINATED'}
                </h2>
                <p className={`${showLeaderboardOnGameOver ? 'text-cyan-200/40' : 'text-red-200/40'} text-sm uppercase tracking-widest transition-colors duration-500`}>
                  {showLeaderboardOnGameOver ? 'Global_Data_Logs // High_Scores' : 'Subject_Compromised // Connection_Lost'}
                </p>
              </div>
              
              <div className={`bg-black/40 p-8 rounded-2xl border ${showLeaderboardOnGameOver ? 'border-cyan-500/20' : 'border-red-500/20'} w-full transition-colors duration-500`}>
                {showLeaderboardOnGameOver ? (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between text-cyan-400 mb-4">
                      <div className="flex items-center gap-2">
                        <Trophy size={18} />
                        <span className="text-xs font-bold uppercase tracking-widest">Global_Leaderboard</span>
                      </div>
                      <button 
                        onClick={() => setShowLeaderboardOnGameOver(false)}
                        className="text-[10px] text-white/40 hover:text-white uppercase"
                      >
                        [Close]
                      </button>
                    </div>
                    <div className="space-y-3">
                      {leaderboard.length > 0 ? (
                        leaderboard.map((entry, i) => (
                          <div key={i} className="flex justify-between items-center text-[10px] border-b border-white/5 pb-2">
                            <div className="flex gap-3">
                              <span className="text-white/20">0{i + 1}</span>
                              <span className="text-white/80 font-bold">{entry.name}</span>
                            </div>
                            <span className="text-cyan-400">{formatTime(entry.time)}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-[10px] text-white/20 text-center py-8 italic">No data logs found...</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="text-red-400 text-[10px] uppercase mb-6">Final_Data_Log</div>
                    <div className="flex justify-center gap-12 mb-8">
                      <div>
                        <div className="text-white/40 text-[10px] mb-1 uppercase">Survival</div>
                        <div className="text-4xl font-bold">{formatTime(uiSurvivalTime)}</div>
                      </div>
                    </div>

                    {!isScoreSaved ? (
                      <div className="space-y-4">
                        <div className="text-[10px] text-white/40 uppercase tracking-widest">Enter_Identifier_To_Save_Log</div>
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            value={playerName}
                            onChange={(e) => setPlayerName(e.target.value.slice(0, 12))}
                            placeholder="GHOST_UNIT_01"
                            className="flex-1 bg-white/5 border border-white/20 rounded px-4 py-2 text-sm focus:outline-none focus:border-red-500 transition-colors"
                          />
                          <button 
                            onClick={saveToLeaderboard}
                            disabled={!playerName.trim()}
                            className="px-6 py-2 bg-red-500 text-white font-bold text-xs uppercase tracking-widest disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-cyan-400 text-xs font-bold uppercase tracking-widest animate-pulse">
                        Log_Securely_Stored_In_Database
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex flex-wrap justify-center gap-4">
                <button 
                  onClick={resetGame}
                  className={`px-8 py-3 ${showLeaderboardOnGameOver ? 'bg-cyan-500' : 'bg-red-500'} text-white font-bold uppercase tracking-widest flex items-center gap-2 hover:opacity-80 transition-all`}
                >
                  Retry_Sequence <RefreshCcw size={16} />
                </button>
                <button 
                  onClick={() => setShowLeaderboardOnGameOver(true)}
                  className={`px-8 py-3 border ${showLeaderboardOnGameOver ? 'border-cyan-500/40 bg-cyan-500/10' : 'border-white/20'} text-white font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-white/10 transition-colors`}
                >
                  Leaderboards <Trophy size={16} />
                </button>
                <button 
                  onClick={backToMenu}
                  className="px-8 py-3 border border-white/20 text-white font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-white/10 transition-colors"
                >
                  Main_Menu <Play size={16} />
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
