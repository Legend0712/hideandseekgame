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
  LeaderboardEntry,
  Powerup,
  PowerupType,
  Collectible,
  Trap,
  MinimapMarker
} from './types';
import { aStar, hasLineOfSight, getVisibilityPolygon } from './utils';
import { MAPS, GameMap } from './maps';
import { Shield, Zap, AlertTriangle, Play, RefreshCcw, Trophy, MousePointer2, Map as MapIcon, ChevronRight } from 'lucide-react';

const MapPreview: React.FC<{ grid: number[][] }> = ({ grid }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const size = canvas.width;
    const tileSize = size / GRID_SIZE;
    
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#06b6d4'; // Cyan for walls
    ctx.shadowBlur = 4;
    ctx.shadowColor = '#06b6d4';
    
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (grid[y][x] === 1) {
          ctx.fillRect(x * tileSize + 1, y * tileSize + 1, tileSize - 2, tileSize - 2);
        }
      }
    }
    ctx.shadowBlur = 0;
  }, [grid]);
  
  return <canvas ref={canvasRef} width={120} height={120} className="bg-black/40 rounded border border-white/10" />;
};

const GameEngine: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  
  // Game State Refs (for high performance loop)
  const playerPosRef = useRef<Point>({ x: 1.5, y: 1.5 });
  const seekersRef = useRef<Seeker[]>([
    { 
      id: '1', 
      pos: { x: GRID_SIZE - 0.5, y: 0.5 }, 
      target: null, 
      path: [], 
      state: 'PATROL', 
      lastKnownPlayerPos: null,
      patrolWaypoint: { x: GRID_SIZE - 0.5, y: 0.5 }
    },
    { 
      id: '2', 
      pos: { x: 0.5, y: GRID_SIZE - 0.5 }, 
      target: null, 
      path: [], 
      state: 'PATROL', 
      lastKnownPlayerPos: null,
      patrolWaypoint: { x: 0.5, y: GRID_SIZE - 0.5 }
    }
  ]);
  const gridRef = useRef<number[][]>(MAPS[0].grid);
  const keysPressed = useRef<Set<string>>(new Set());
  const detectionMeterRef = useRef<number>(0);
  const survivalTimeRef = useRef<number>(0);
  const statusRef = useRef<GameStatus>('HIDING');
  const spawnTimerRef = useRef<number>(0);
  const seekerSpawnTimerRef = useRef<number>(0);
  const powerupsRef = useRef<Powerup[]>([]);
  const collectiblesRef = useRef<Collectible[]>([]);
  const trapsRef = useRef<Trap[]>([]);
  const minimapMarkersRef = useRef<MinimapMarker[]>([]);
  const activePowerupRef = useRef<{ type: PowerupType; endTime: number } | null>(null);
  const clonePosRef = useRef<Point | null>(null);
  const hasCloneRef = useRef<boolean>(false);
  const teleportTimerRef = useRef<number>(0);

  // Audio Refs
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);
  const menuMusicRef = useRef<HTMLAudioElement | null>(null);
  const sfxRef = useRef<{ [key: string]: HTMLAudioElement }>({});

  // React State (for UI)
  const [uiStatus, setUiStatus] = useState<GameStatus>('HIDING');
  const [uiSurvivalTime, setUiSurvivalTime] = useState(0);
  const [dotsCollected, setDotsCollected] = useState(0);
  const dotsCollectedRef = useRef(0);
  const [isPaused, setIsPaused] = useState(false);
  const [bestRecords, setBestRecords] = useState<{ [key: number]: number }>({});
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [isMapSelecting, setIsMapSelecting] = useState(false);
  const [selectedMapIndex, setSelectedMapIndex] = useState(0);
  const [playerName, setPlayerName] = useState('');
  const [leaderboards, setLeaderboards] = useState<{ [key: number]: LeaderboardEntry[] }>({});
  const [isScoreSaved, setIsScoreSaved] = useState(false);
  const [showLeaderboardOnGameOver, setShowLeaderboardOnGameOver] = useState(false);
  const [activePowerupUI, setActivePowerupUI] = useState<{ type: PowerupType; timeLeft: number } | null>(null);
  const [hasCloneUI, setHasCloneUI] = useState(false);
  const [hoveredMapIndex, setHoveredMapIndex] = useState<number | null>(null);

  useEffect(() => {
    const savedBests = localStorage.getItem('neon_shadows_bests');
    if (savedBests) setBestRecords(JSON.parse(savedBests));
    
    const savedLeaderboards = localStorage.getItem('neon_shadows_leaderboards');
    if (savedLeaderboards) setLeaderboards(JSON.parse(savedLeaderboards));

    // Initialize Audio
    bgMusicRef.current = new Audio('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3');
    bgMusicRef.current.loop = true;
    bgMusicRef.current.volume = 0.3;

    menuMusicRef.current = new Audio('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3');
    menuMusicRef.current.loop = true;
    menuMusicRef.current.volume = 0.4;

    sfxRef.current = {
      collect: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-arcade-game-jump-coin-272.mp3'),
      clone: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-sci-fi-interface-robot-click-2544.mp3'),
      teleport: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-sci-fi-teleport-948.mp3'),
      slowmo: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-slow-motion-wind-2244.mp3'),
      caught: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-game-over-dark-orchestra-633.mp3'),
      click: new Audio('https://assets.mixkit.co/sfx/preview/mixkit-modern-technology-select-3124.mp3'),
    };

    return () => {
      if (bgMusicRef.current) {
        bgMusicRef.current.pause();
        bgMusicRef.current = null;
      }
      if (menuMusicRef.current) {
        menuMusicRef.current.pause();
        menuMusicRef.current = null;
      }
    };
  }, []);

  const playSFX = (key: string) => {
    const audio = sfxRef.current[key];
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  };

  const saveToLeaderboard = () => {
    if (!playerName.trim()) return;
    const newEntry: LeaderboardEntry = {
      name: playerName.trim(),
      dots: dotsCollectedRef.current,
      time: survivalTimeRef.current,
      date: new Date().toLocaleDateString()
    };
    const currentMapLeaderboard = leaderboards[selectedMapIndex] || [];
    const updatedLeaderboard = [...currentMapLeaderboard, newEntry]
      .sort((a, b) => {
        if (b.dots !== a.dots) return b.dots - a.dots;
        return b.time - a.time;
      })
      .slice(0, 10);
    
    const newLeaderboards = { ...leaderboards, [selectedMapIndex]: updatedLeaderboard };
    setLeaderboards(newLeaderboards);
    localStorage.setItem('neon_shadows_leaderboards', JSON.stringify(newLeaderboards));
    setIsScoreSaved(true);
  };

  const spawnPowerup = useCallback(() => {
    const types: PowerupType[] = ['SLOWMO', 'CLONE', 'TELEPORT'];
    const type = types[Math.floor(Math.random() * types.length)];
    
    let x, y;
    let attempts = 0;
    do {
      x = Math.floor(Math.random() * (GRID_SIZE - 2)) + 1;
      y = Math.floor(Math.random() * (GRID_SIZE - 2)) + 1;
      attempts++;
    } while (
      (gridRef.current[y][x] === 1 || 
      Math.sqrt(Math.pow(x - playerPosRef.current.x, 2) + Math.pow(y - playerPosRef.current.y, 2)) < 5) &&
      attempts < 100
    );

    if (attempts < 100) {
      powerupsRef.current.push({ id: Math.random().toString(), type, pos: { x: x + 0.5, y: y + 0.5 } });
    }
  }, []);

  const resetGame = useCallback(() => {
    // Stop menu music
    if (menuMusicRef.current) menuMusicRef.current.pause();

    playerPosRef.current = { x: 1.5, y: 1.5 };
    gridRef.current = MAPS[selectedMapIndex].grid;
    const corners = [
      { x: 0.5, y: 0.5 },
      { x: GRID_SIZE - 0.5, y: 0.5 },
      { x: GRID_SIZE - 0.5, y: GRID_SIZE - 0.5 },
      { x: 0.5, y: GRID_SIZE - 0.5 }
    ];
    
    // Pick two different corners far from the player (who starts at 1.5, 1.5)
    const validCorners = corners.filter(corner => {
      const dist = Math.sqrt(
        Math.pow(corner.x - 1.5, 2) + 
        Math.pow(corner.y - 1.5, 2)
      );
      return dist > 10;
    });
    
    const shuffled = [...validCorners].sort(() => Math.random() - 0.5);
    const startCorners = shuffled.slice(0, 2);

    seekersRef.current = startCorners.map((corner, i) => ({
      id: (i + 1).toString(),
      pos: { ...corner },
      target: null,
      path: [],
      state: 'PATROL',
      lastKnownPlayerPos: null,
      patrolWaypoint: { ...corner },
      canSeePlayer: false
    }));

    detectionMeterRef.current = 0;
    survivalTimeRef.current = 0;
    dotsCollectedRef.current = 0;
    setDotsCollected(0);
    spawnTimerRef.current = 0;
    seekerSpawnTimerRef.current = 0;
    powerupsRef.current = [];
    collectiblesRef.current = [];
    trapsRef.current = [];
    minimapMarkersRef.current = [];
    
    // Spawn 20 white dots
    for (let i = 0; i < 20; i++) {
      let x, y;
      do {
        x = Math.floor(Math.random() * GRID_SIZE);
        y = Math.floor(Math.random() * GRID_SIZE);
      } while (gridRef.current[y][x] === 1 || (x < 5 && y < 5));
      collectiblesRef.current.push({ id: Math.random().toString(), pos: { x: x + 0.5, y: y + 0.5 } });
    }

    activePowerupRef.current = null;
    clonePosRef.current = null;
    hasCloneRef.current = false;
    setHasCloneUI(false);
    teleportTimerRef.current = 0;
    statusRef.current = 'HIDING';
    setUiStatus('HIDING');
    setUiSurvivalTime(0);
    setIsGameStarted(true);
    setIsMapSelecting(false);
    setIsScoreSaved(false);
    setShowLeaderboardOnGameOver(false);
    setActivePowerupUI(null);
    setIsPaused(false);
    spawnPowerup();

    if (bgMusicRef.current) {
      bgMusicRef.current.currentTime = 0;
      bgMusicRef.current.play().catch(() => {});
    }
  }, [selectedMapIndex, spawnPowerup]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    keysPressed.current.add(key);

    if (key === ' ' && hasCloneRef.current && isGameStarted && statusRef.current !== 'CAUGHT') {
      clonePosRef.current = { ...playerPosRef.current };
      hasCloneRef.current = false;
      setHasCloneUI(false);
      playSFX('clone');
      
      // Clone lasts 10 seconds
      activePowerupRef.current = { type: 'CLONE', endTime: Date.now() + 10000 };
    }

    if (key === 'shift' && isGameStarted && statusRef.current !== 'CAUGHT' && dotsCollectedRef.current >= 5) {
      dotsCollectedRef.current -= 5;
      setDotsCollected(dotsCollectedRef.current);
      trapsRef.current.push({ id: Math.random().toString(), pos: { ...playerPosRef.current } });
      playSFX('click');
    }

    if (key === 'escape' && isGameStarted && statusRef.current !== 'CAUGHT') {
      setIsPaused(prev => !prev);
      playSFX('click');
    }
  }, [isGameStarted]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => keysPressed.current.delete(e.key.toLowerCase()), []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [handleKeyDown, handleKeyUp]);

  const spawnSeeker = () => {
    const corners = [
      { x: 0.5, y: 0.5 },
      { x: GRID_SIZE - 0.5, y: 0.5 },
      { x: GRID_SIZE - 0.5, y: GRID_SIZE - 0.5 },
      { x: 0.5, y: GRID_SIZE - 0.5 }
    ];
    
    // Pick a corner that is far from the player
    const validCorners = corners.filter(corner => {
      const dist = Math.sqrt(
        Math.pow(corner.x - playerPosRef.current.x, 2) + 
        Math.pow(corner.y - playerPosRef.current.y, 2)
      );
      return dist > 10; // At least 10 tiles away
    });

    const corner = validCorners.length > 0 
      ? validCorners[Math.floor(Math.random() * validCorners.length)]
      : corners[Math.floor(Math.random() * corners.length)];

    const newSeeker: Seeker = {
      id: Date.now().toString(),
      pos: { ...corner },
      target: null,
      path: [],
      state: 'PATROL',
      lastKnownPlayerPos: null,
      patrolWaypoint: { ...corner },
      canSeePlayer: false
    };
    seekersRef.current.push(newSeeker);
  };

  const backToMenu = () => {
    setIsGameStarted(false);
    setIsMapSelecting(false);
    setUiStatus('HIDING');
    statusRef.current = 'HIDING';
    setShowLeaderboardOnGameOver(false);
    if (bgMusicRef.current) bgMusicRef.current.pause();
    if (menuMusicRef.current) {
      menuMusicRef.current.currentTime = 0;
      menuMusicRef.current.play().catch(() => {});
    }
  };

  const update = (delta: number) => {
    if (statusRef.current === 'CAUGHT' || isPaused) {
      if (bgMusicRef.current && statusRef.current === 'CAUGHT') bgMusicRef.current.pause();
      return;
    }

    // Handle Teleportation Freeze
    if (activePowerupRef.current?.type === 'TELEPORT') {
      const timeLeft = (activePowerupRef.current.endTime - Date.now()) / 1000;
      if (timeLeft <= 0) {
        activePowerupRef.current = null;
        setActivePowerupUI(null);
      } else {
        setActivePowerupUI({ type: 'TELEPORT', timeLeft });
        return; // Freeze game logic
      }
    }

    // Handle Powerup Expiration
    if (activePowerupRef.current) {
      const timeLeft = (activePowerupRef.current.endTime - Date.now()) / 1000;
      if (timeLeft <= 0) {
        if (activePowerupRef.current.type === 'CLONE') clonePosRef.current = null;
        activePowerupRef.current = null;
        setActivePowerupUI(null);
      } else {
        setActivePowerupUI({ type: activePowerupRef.current.type, timeLeft });
      }
    }

    const isSlowMo = activePowerupRef.current?.type === 'SLOWMO';
    const gameDelta = isSlowMo ? delta * 0.25 : delta;

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

    // Powerup Collection
    powerupsRef.current.forEach((p, index) => {
      const dist = Math.sqrt(Math.pow(p.pos.x - playerPosRef.current.x, 2) + Math.pow(p.pos.y - playerPosRef.current.y, 2));
      if (dist < 0.8) {
        playSFX('collect');
        if (p.type === 'CLONE') {
          hasCloneRef.current = true;
          setHasCloneUI(true);
        } else {
          const duration = 5000;
          activePowerupRef.current = { type: p.type, endTime: Date.now() + duration };
          if (p.type === 'SLOWMO') playSFX('slowmo');
        }
        powerupsRef.current.splice(index, 1);
      }
    });

    // Collectible Collection (White Dots)
    collectiblesRef.current.forEach((c, index) => {
      const dist = Math.sqrt(Math.pow(c.pos.x - playerPosRef.current.x, 2) + Math.pow(c.pos.y - playerPosRef.current.y, 2));
      if (dist < 0.8) {
        playSFX('collect');
        dotsCollectedRef.current++;
        setDotsCollected(dotsCollectedRef.current);
        collectiblesRef.current.splice(index, 1);
      }
    });

    // Trap Collision
    seekersRef.current.forEach((seeker, sIndex) => {
      trapsRef.current.forEach((trap, tIndex) => {
        const dist = Math.sqrt(Math.pow(seeker.pos.x - trap.pos.x, 2) + Math.pow(seeker.pos.y - trap.pos.y, 2));
        if (dist < 0.6) {
          // AI dies
          minimapMarkersRef.current.push({
            id: Math.random().toString(),
            pos: { ...seeker.pos },
            type: 'DEATH',
            startTime: Date.now(),
            duration: 2000
          });
          seekersRef.current.splice(sIndex, 1);
          trapsRef.current.splice(tIndex, 1);
          playSFX('teleport');
        }
      });
    });

    // 2. Seeker Logic
    let anySpotted = false;
    const actualPlayerPos = playerPosRef.current;
    const distractionPos = clonePosRef.current;

    seekersRef.current.forEach(seeker => {
      // Seeker chases the clone if it exists, otherwise the player
      const currentTarget = distractionPos || actualPlayerPos;
      const canSeeTarget = hasLineOfSight(seeker.pos, currentTarget, gridRef.current, DETECTION_RADIUS);
      
      // Detection meter only increases if the seeker sees the ACTUAL player
      const canSeePlayer = hasLineOfSight(seeker.pos, actualPlayerPos, gridRef.current, DETECTION_RADIUS);
      
      const speed = seeker.state === 'CHASE' ? SEEKER_SPEED_CHASE : SEEKER_SPEED_PATROL;
      const moveStep = (speed * (gameDelta / 16.67)) / TILE_SIZE;

      if (canSeeTarget) {
        seeker.state = 'CHASE';
        seeker.lastKnownPlayerPos = { ...currentTarget };
        
        // When in LoS, move directly towards the target for smoothness
        const sdx = currentTarget.x - seeker.pos.x;
        const sdy = currentTarget.y - seeker.pos.y;
        const dist = Math.sqrt(sdx * sdx + sdy * sdy);
        
        if (dist > 0.1) {
          const nextX = seeker.pos.x + (sdx / dist) * moveStep;
          const nextY = seeker.pos.y + (sdy / dist) * moveStep;
          
          // Basic wall collision for seekers to prevent getting stuck on corners
          const gridX = Math.floor(nextX);
          const gridY = Math.floor(nextY);
          
          if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE) {
            if (gridRef.current[Math.floor(seeker.pos.y)][gridX] === 0) {
              seeker.pos.x = nextX;
            }
            if (gridRef.current[gridY][Math.floor(seeker.pos.x)] === 0) {
              seeker.pos.y = nextY;
            }
          }
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
            const nextX = seeker.pos.x + (sdx / dist) * moveStep;
            const nextY = seeker.pos.y + (sdy / dist) * moveStep;
            
            // Basic wall collision for seekers
            const gridX = Math.floor(nextX);
            const gridY = Math.floor(nextY);
            
            if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE) {
              if (gridRef.current[Math.floor(seeker.pos.y)][gridX] === 0) {
                seeker.pos.x = nextX;
              }
              if (gridRef.current[gridY][Math.floor(seeker.pos.x)] === 0) {
                seeker.pos.y = nextY;
              }
            }
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
            const nextX = seeker.pos.x + (sdx / dist) * moveStep;
            const nextY = seeker.pos.y + (sdy / dist) * moveStep;
            
            // Basic wall collision for seekers
            const gridX = Math.floor(nextX);
            const gridY = Math.floor(nextY);
            
            if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE) {
              if (gridRef.current[Math.floor(seeker.pos.y)][gridX] === 0) {
                seeker.pos.x = nextX;
              }
              if (gridRef.current[gridY][Math.floor(seeker.pos.x)] === 0) {
                seeker.pos.y = nextY;
              }
            }
          }
        }
      }

      if (canSeePlayer) {
        anySpotted = true;
        seeker.canSeePlayer = true;
      } else {
        seeker.canSeePlayer = false;
      }

      // Nudge out of walls if stuck
      const curGX = Math.floor(seeker.pos.x);
      const curGY = Math.floor(seeker.pos.y);
      if (curGX >= 0 && curGX < GRID_SIZE && curGY >= 0 && curGY < GRID_SIZE && gridRef.current[curGY][curGX] === 1) {
        const neighbors = [
          { x: curGX + 1, y: curGY },
          { x: curGX - 1, y: curGY },
          { x: curGX, y: curGY + 1 },
          { x: curGX, y: curGY - 1 },
        ];
        for (const n of neighbors) {
          if (n.x >= 0 && n.x < GRID_SIZE && n.y >= 0 && n.y < GRID_SIZE && gridRef.current[n.y][n.x] === 0) {
            seeker.pos.x = n.x + 0.5;
            seeker.pos.y = n.y + 0.5;
            seeker.path = []; // Recalculate path
            break;
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
        playSFX('caught');
        if (bgMusicRef.current) bgMusicRef.current.pause();
        const currentBest = bestRecords[selectedMapIndex] || 0;
        if (survivalTimeRef.current > currentBest) {
          const newBests = { ...bestRecords, [selectedMapIndex]: survivalTimeRef.current };
          setBestRecords(newBests);
          localStorage.setItem('neon_shadows_bests', JSON.stringify(newBests));
        }
      }
    });

    // 3. Detection Meter
    if (anySpotted) {
      detectionMeterRef.current = Math.min(1, detectionMeterRef.current + DETECTION_RATE * (isSlowMo ? 0.25 : 1));
      statusRef.current = 'SPOTTED';
    } else {
      detectionMeterRef.current = Math.max(0, detectionMeterRef.current - COOLDOWN_RATE * (isSlowMo ? 0.25 : 1));
      if (detectionMeterRef.current === 0) statusRef.current = 'HIDING';
    }

    if (detectionMeterRef.current >= 1 && statusRef.current !== 'CAUGHT') {
      statusRef.current = 'CAUGHT';
      setUiStatus('CAUGHT');
      playSFX('caught');
      if (bgMusicRef.current) bgMusicRef.current.pause();
      const currentBest = bestRecords[selectedMapIndex] || 0;
      if (survivalTimeRef.current > currentBest) {
        const newBests = { ...bestRecords, [selectedMapIndex]: survivalTimeRef.current };
        setBestRecords(newBests);
        localStorage.setItem('neon_shadows_bests', JSON.stringify(newBests));
      }
    }

    // 4. Spawning Logic
    spawnTimerRef.current += delta / 1000;
    if (spawnTimerRef.current >= 15) {
      spawnTimerRef.current = 0;
      spawnPowerup();
    }

    // Seeker Spawning Logic
    const expectedSeekerCount = 2 + Math.floor(survivalTimeRef.current / 10);
    if (seekersRef.current.length < expectedSeekerCount) {
      // Check if we already have a spawn marker for this "missing" seeker
      const spawnMarkers = minimapMarkersRef.current.filter(m => m.type === 'SPAWN');
      if (spawnMarkers.length < (expectedSeekerCount - seekersRef.current.length)) {
        const corners = [
          { x: 0.5, y: 0.5 },
          { x: GRID_SIZE - 0.5, y: 0.5 },
          { x: GRID_SIZE - 0.5, y: GRID_SIZE - 0.5 },
          { x: 0.5, y: GRID_SIZE - 0.5 }
        ];
        const validCorners = corners.filter(corner => {
          const dist = Math.sqrt(Math.pow(corner.x - playerPosRef.current.x, 2) + Math.pow(corner.y - playerPosRef.current.y, 2));
          return dist > 10;
        });
        const corner = validCorners.length > 0 ? validCorners[Math.floor(Math.random() * validCorners.length)] : corners[Math.floor(Math.random() * corners.length)];
        
        minimapMarkersRef.current.push({
          id: Math.random().toString(),
          pos: { ...corner },
          type: 'SPAWN',
          startTime: Date.now(),
          duration: 2000
        });
      }
    }

    // Process Spawn Markers
    minimapMarkersRef.current.forEach((marker, index) => {
      if (Date.now() - marker.startTime > marker.duration) {
        if (marker.type === 'SPAWN') {
          const newSeeker: Seeker = {
            id: Date.now().toString() + Math.random(),
            pos: { ...marker.pos },
            target: null,
            path: [],
            state: 'PATROL',
            lastKnownPlayerPos: null,
            patrolWaypoint: { ...marker.pos },
            canSeePlayer: false
          };
          seekersRef.current.push(newSeeker);
        }
        minimapMarkersRef.current.splice(index, 1);
      }
    });

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
      // Show red radius if chasing OR if the player is currently spotted by this seeker
      if (seeker.state === 'CHASE' || seeker.canSeePlayer) {
        const poly = getVisibilityPolygon(seeker.pos, gridRef.current, DETECTION_RADIUS);
        if (poly.length > 0) {
          // Use red if they see the player, amber if they only see the clone/are just chasing
          ctx.fillStyle = seeker.canSeePlayer ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)';
          ctx.beginPath();
          ctx.moveTo(seeker.pos.x * TILE_SIZE, seeker.pos.y * TILE_SIZE);
          poly.forEach(p => {
            ctx.lineTo(p.x * TILE_SIZE, p.y * TILE_SIZE);
          });
          ctx.closePath();
          ctx.fill();
          
          // Add a subtle glow to the edge
          ctx.strokeStyle = seeker.canSeePlayer ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)';
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

    // Draw Powerups
    powerupsRef.current.forEach(p => {
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#22c55e'; // Green
      ctx.fillStyle = '#22c55e'; // Green
      ctx.beginPath();
      ctx.arc(p.pos.x * TILE_SIZE, p.pos.y * TILE_SIZE, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      
      ctx.fillStyle = 'white';
      ctx.font = '8px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(p.type[0], p.pos.x * TILE_SIZE, p.pos.y * TILE_SIZE + 3);
    });

    // Draw Collectibles (White Dots)
    collectiblesRef.current.forEach(c => {
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 5;
      ctx.shadowColor = '#ffffff';
      ctx.beginPath();
      ctx.arc(c.pos.x * TILE_SIZE, c.pos.y * TILE_SIZE, TILE_SIZE * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // Draw Traps (Grey Dots)
    trapsRef.current.forEach(t => {
      ctx.fillStyle = '#6b7280'; // Grey
      ctx.beginPath();
      ctx.arc(t.pos.x * TILE_SIZE, t.pos.y * TILE_SIZE, TILE_SIZE * 0.25, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Clone
    if (clonePosRef.current) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = 'rgba(6, 182, 212, 0.5)';
      ctx.fillStyle = 'rgba(6, 182, 212, 0.4)';
      ctx.beginPath();
      ctx.arc(clonePosRef.current.x * TILE_SIZE, clonePosRef.current.y * TILE_SIZE, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

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

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activePowerupRef.current?.type === 'TELEPORT') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      
      const clickX = (e.clientX - rect.left) * scaleX;
      const clickY = (e.clientY - rect.top) * scaleY;
      
      const gridX = Math.floor(clickX / TILE_SIZE);
      const gridY = Math.floor(clickY / TILE_SIZE);
      
      if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE && gridRef.current[gridY][gridX] === 0) {
        playerPosRef.current = { x: gridX + 0.5, y: gridY + 0.5 };
        activePowerupRef.current = null;
        setActivePowerupUI(null);
        playSFX('teleport');
      }
    }
  };

  // Memoized Minimap Grid
  const minimapGrid = React.useMemo(() => {
    return (
      <div className="absolute inset-0 grid grid-cols-[repeat(30,1fr)] grid-rows-[repeat(30,1fr)] opacity-10">
        {MAPS[selectedMapIndex].grid.flat().map((cell, i) => (
          <div key={i} className={cell === 1 ? 'bg-white/20' : ''} />
        ))}
      </div>
    );
  }, [selectedMapIndex]);

  return (
    <div className="relative w-full h-screen bg-black text-white font-mono overflow-hidden flex items-center justify-center">
      {/* Pause Menu */}
      <AnimatePresence>
        {isPaused && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center"
          >
            <div className="text-center space-y-8">
              <div className="space-y-2">
                <h2 className="text-6xl font-black text-cyan-500 tracking-tighter italic">PAUSED</h2>
                <p className="text-cyan-200/40 text-xs uppercase tracking-widest">System_Suspended // Waiting_For_Input</p>
              </div>
              
              <div className="flex flex-col gap-4 w-64 mx-auto">
                <button 
                  onClick={() => setIsPaused(false)}
                  className="w-full py-4 bg-cyan-500 text-black font-black text-sm uppercase tracking-[0.2em] hover:bg-cyan-400 transition-colors flex items-center justify-center gap-3"
                >
                  <Play size={18} fill="currentColor" />
                  Resume_Node
                </button>
                <button 
                  onClick={backToMenu}
                  className="w-full py-4 bg-white/5 border border-white/10 text-white font-bold text-sm uppercase tracking-[0.2em] hover:bg-white/10 transition-colors flex items-center justify-center gap-3"
                >
                  <RefreshCcw size={18} />
                  Quit_Mission
                </button>
              </div>
              
              <div className="text-[10px] text-white/20 uppercase tracking-widest">
                Press [Esc] to resume
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Powerup UI */}
      {activePowerupUI && (
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 z-30 text-center pointer-events-none">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`text-2xl font-bold uppercase tracking-[0.2em] px-6 py-2 rounded-full border backdrop-blur-md ${
              activePowerupUI.type === 'SLOWMO' ? 'text-purple-400 border-purple-500/50 bg-purple-500/10' :
              activePowerupUI.type === 'CLONE' ? 'text-cyan-400 border-cyan-500/50 bg-cyan-500/10' :
              'text-amber-400 border-amber-500/50 bg-amber-500/10'
            }`}
          >
            {activePowerupUI.type === 'SLOWMO' ? 'SlowMo' : 
             activePowerupUI.type === 'CLONE' ? 'Cloned' : 
             `Teleport in ${Math.ceil(activePowerupUI.timeLeft)} seconds`}
          </motion.div>
          {activePowerupUI.type === 'TELEPORT' && (
            <div className="mt-4 text-xs text-white/40 uppercase tracking-widest animate-pulse">
              Click anywhere on the map to jump
            </div>
          )}
        </div>
      )}

      {/* HUD Top Left */}
      <div className="absolute top-8 left-8 z-20 space-y-4">
        <div className="bg-black/40 backdrop-blur-md border border-white/10 p-4 rounded-lg">
          <div className="text-[10px] text-white uppercase tracking-widest mb-1">Data_Nodes</div>
          <div className="text-4xl font-bold text-white tabular-nums">
            {dotsCollected}
          </div>
        </div>
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
            {formatTime(bestRecords[selectedMapIndex] || 0)}
          </div>
        </div>
      </div>

      {/* HUD Top Right */}
      <div className="absolute top-8 right-8 z-20">
        <div className="w-48 h-48 bg-black/60 border border-white/10 rounded-lg overflow-hidden relative flex flex-col">
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            <div className="w-full h-full bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>
          </div>
          <div className="p-2 text-[8px] text-white/40 uppercase tracking-tighter border-b border-white/5">Locator_V4.2 // Node_77</div>
          <div className="flex-1 relative">
             {/* Mini Map */}
             <div className="absolute inset-0 p-1">
                <div className="relative w-full h-full">
                  {/* Grid background for minimap */}
                  {minimapGrid}
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
                  {powerupsRef.current.map(p => (
                    <div 
                      key={p.id}
                      className="absolute w-1 h-1 rounded-full bg-white animate-pulse shadow-[0_0_3px_white]"
                      style={{ 
                        left: `${(p.pos.x / GRID_SIZE) * 100}%`, 
                        top: `${(p.pos.y / GRID_SIZE) * 100}%` 
                      }}
                    />
                  ))}
                  {collectiblesRef.current.map(c => (
                    <div 
                      key={c.id}
                      className="absolute w-0.5 h-0.5 rounded-full bg-white/50"
                      style={{ 
                        left: `${(c.pos.x / GRID_SIZE) * 100}%`, 
                        top: `${(c.pos.y / GRID_SIZE) * 100}%` 
                      }}
                    />
                  ))}
                  {trapsRef.current.map(t => (
                    <div 
                      key={t.id}
                      className="absolute w-1 h-1 rounded-full bg-gray-500"
                      style={{ 
                        left: `${(t.pos.x / GRID_SIZE) * 100}%`, 
                        top: `${(t.pos.y / GRID_SIZE) * 100}%` 
                      }}
                    />
                  ))}
                  {minimapMarkersRef.current.map(m => (
                    <div 
                      key={m.id}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center`}
                      style={{ 
                        left: `${(m.pos.x / GRID_SIZE) * 100}%`, 
                        top: `${(m.pos.y / GRID_SIZE) * 100}%` 
                      }}
                    >
                      <div className={`w-3 h-3 rounded-full border-2 ${m.type === 'SPAWN' ? 'border-red-500 animate-ping' : 'border-green-500 animate-ping'}`} />
                      <div className={`absolute w-1.5 h-1.5 rounded-full border ${m.type === 'SPAWN' ? 'border-red-500' : 'border-green-500'}`} />
                    </div>
                  ))}
                </div>
             </div>
          </div>
        </div>
        {hasCloneUI && (
          <motion.div 
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="mt-4 bg-cyan-500/10 border border-cyan-500/50 p-3 rounded-lg flex items-center gap-3"
          >
            <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse shadow-[0_0_5px_cyan]" />
            <div className="text-[10px] uppercase tracking-widest text-cyan-400">
              Clone Ready <span className="text-white/40 ml-2">[SPACE]</span>
            </div>
          </motion.div>
        )}
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
      <div className="relative border border-white/10 shadow-[0_0_50px_rgba(168,85,247,0.05)] max-h-[85vh] aspect-square">
        <canvas 
          ref={canvasRef}
          width={VIEWPORT_SIZE}
          height={VIEWPORT_SIZE}
          onClick={handleCanvasClick}
          className={`bg-black w-full h-full object-contain ${activePowerupRef.current?.type === 'TELEPORT' ? 'cursor-crosshair' : ''}`}
        />
        
        {/* Scanline Effect */}
        <div className="absolute inset-0 pointer-events-none opacity-10 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />
      </div>

      {/* Overlays */}
      <AnimatePresence>
        {!isGameStarted && !isMapSelecting && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center"
            onClick={() => {
              // Play menu music on first interaction
              if (menuMusicRef.current && menuMusicRef.current.paused) {
                menuMusicRef.current.play().catch(() => {});
              }
            }}
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
                  onClick={() => {
                    playSFX('click');
                    setIsMapSelecting(true);
                  }}
                  className="group relative px-12 py-4 bg-white text-black font-bold uppercase tracking-widest overflow-hidden transition-transform active:scale-95"
                >
                  <div className="absolute inset-0 bg-cyan-400 translate-x-full group-hover:translate-x-0 transition-transform duration-300" />
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    Initialize_Protocol <Play size={16} fill="currentColor" />
                  </span>
                </button>
              </div>

              {/* General Info */}
              <div className="w-80 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md">
                <div className="flex items-center gap-2 mb-6 text-cyan-400">
                  <Shield size={18} />
                  <span className="text-xs font-bold uppercase tracking-widest">System_Status</span>
                </div>
                <div className="space-y-4 text-[10px] text-white/60 uppercase tracking-widest">
                  <div className="flex justify-between">
                    <span>Encryption</span>
                    <span className="text-green-400">Active</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Node_Sync</span>
                    <span className="text-green-400">Stable</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Threat_Level</span>
                    <span className="text-red-400">Critical</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {isMapSelecting && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/90 backdrop-blur-2xl flex flex-col items-center justify-center p-8"
          >
            <div className="max-w-6xl w-full">
              <div className="flex justify-between items-end mb-12">
                <div>
                  <h2 className="text-4xl font-black tracking-tighter italic text-white mb-2">SELECT_ARENA</h2>
                  <p className="text-white/40 text-xs uppercase tracking-widest">Available_Nodes // Sector_7</p>
                </div>
                <button 
                  onClick={() => {
                    playSFX('click');
                    setIsMapSelecting(false);
                  }}
                  className="text-xs text-white/40 hover:text-white uppercase tracking-widest"
                >
                  [Back_To_Menu]
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {MAPS.map((map, index) => (
                  <motion.div 
                    key={index}
                    onMouseEnter={() => setHoveredMapIndex(index)}
                    onMouseLeave={() => setHoveredMapIndex(null)}
                    whileHover={{ scale: 1.02 }}
                    className={`relative group bg-white/5 border ${selectedMapIndex === index ? 'border-cyan-500' : 'border-white/10'} rounded-xl p-6 transition-all overflow-hidden`}
                  >
                    <div className="flex justify-center mb-6">
                      <MapPreview grid={map.grid} />
                    </div>
                    <h3 className="text-xl font-bold mb-2 text-white">{map.name}</h3>
                    <p className="text-[10px] text-white/40 mb-6 leading-relaxed uppercase tracking-wider">{map.description}</p>
                    
                    {/* Hover Overlay */}
                    <AnimatePresence>
                      {hoveredMapIndex === index && (
                        <motion.div 
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 20 }}
                          className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 gap-3 z-10"
                        >
                          <button 
                            onClick={() => {
                              playSFX('click');
                              setSelectedMapIndex(index);
                              resetGame();
                            }}
                            className="w-full py-3 bg-cyan-500 text-black font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-cyan-400 transition-colors"
                          >
                            Play_Node <Play size={14} fill="currentColor" />
                          </button>
                          <button 
                            onClick={() => {
                              playSFX('click');
                              setSelectedMapIndex(index);
                              setShowLeaderboardOnGameOver(true);
                              setUiStatus('CAUGHT');
                            }}
                            className="w-full py-3 bg-white/10 border border-white/20 text-white font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-white/20 transition-colors"
                          >
                            Leaderboard <Trophy size={14} />
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {uiStatus === 'CAUGHT' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`absolute inset-0 z-50 ${showLeaderboardOnGameOver ? 'bg-cyan-950/90' : 'bg-red-950/90'} backdrop-blur-xl flex items-center justify-center transition-colors duration-500 overflow-y-auto p-4`}
          >
            <div className="text-center space-y-6 max-w-xl px-4 w-full my-auto">
              <div className="space-y-2">
                <h2 className={`text-5xl md:text-7xl lg:text-8xl font-black ${showLeaderboardOnGameOver ? 'text-cyan-500' : 'text-red-500'} tracking-tighter italic transition-colors duration-500`}>
                  {showLeaderboardOnGameOver ? 'LEADERBOARD' : 'TERMINATED'}
                </h2>
                <p className={`${showLeaderboardOnGameOver ? 'text-cyan-200/40' : 'text-red-200/40'} text-[10px] md:text-xs uppercase tracking-widest transition-colors duration-500`}>
                  {showLeaderboardOnGameOver ? 'Global_Data_Logs // High_Scores' : 'Subject_Compromised // Connection_Lost'}
                </p>
              </div>
              
              <div className={`bg-black/40 p-4 md:p-8 rounded-2xl border ${showLeaderboardOnGameOver ? 'border-cyan-500/20' : 'border-red-500/20'} w-full transition-colors duration-500`}>
                {showLeaderboardOnGameOver ? (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between text-cyan-400 mb-4">
                      <div className="flex items-center gap-2">
                        <Trophy size={18} />
                        <span className="text-xs font-bold uppercase tracking-widest">{MAPS[selectedMapIndex].name}_Logs</span>
                      </div>
                      <button 
                        onClick={() => {
                          playSFX('click');
                          setShowLeaderboardOnGameOver(false);
                          if (!isGameStarted && !isMapSelecting) setUiStatus('HIDING'); // Reset the trick
                        }}
                        className="text-[10px] text-white/40 hover:text-white uppercase"
                      >
                        [Close]
                      </button>
                    </div>
                    <div className="space-y-3">
                      {(leaderboards[selectedMapIndex] || []).length > 0 ? (
                        (leaderboards[selectedMapIndex] || []).map((entry, i) => (
                          <div key={i} className="flex justify-between items-center text-[10px] border-b border-white/5 pb-2">
                            <div className="flex gap-3">
                              <span className="text-white/20">0{i + 1}</span>
                              <span className="text-white/80 font-bold">{entry.name}</span>
                            </div>
                            <div className="flex gap-4">
                              <span className="text-white font-bold">{entry.dots}</span>
                              <span className="text-cyan-400">{formatTime(entry.time)}</span>
                            </div>
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
                        <div className="text-white/40 text-[10px] mb-1 uppercase">Data_Nodes</div>
                        <div className="text-4xl font-bold text-white">{dotsCollected}</div>
                      </div>
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
                            onClick={() => {
                              playSFX('click');
                              saveToLeaderboard();
                            }}
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
                  onClick={() => {
                    playSFX('click');
                    resetGame();
                  }}
                  className={`px-8 py-3 ${showLeaderboardOnGameOver ? 'bg-cyan-500' : 'bg-red-500'} text-white font-bold uppercase tracking-widest flex items-center gap-2 hover:opacity-80 transition-all`}
                >
                  Retry_Sequence <RefreshCcw size={16} />
                </button>
                <button 
                  onClick={() => {
                    playSFX('click');
                    setShowLeaderboardOnGameOver(true);
                  }}
                  className={`px-8 py-3 border ${showLeaderboardOnGameOver ? 'border-cyan-500/40 bg-cyan-500/10' : 'border-white/20'} text-white font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-white/10 transition-colors`}
                >
                  Leaderboards <Trophy size={16} />
                </button>
                <button 
                  onClick={() => {
                    playSFX('click');
                    backToMenu();
                  }}
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
