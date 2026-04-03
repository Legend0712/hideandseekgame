import { GRID_SIZE } from './types';

export interface GameMap {
  name: string;
  grid: number[][];
  description: string;
}

const createEmptyGrid = () => Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));

export const generateDynamicGrid = (seed: number, protectedPoints: {x: number, y: number}[] = []) => {
  const grid = createEmptyGrid();
  let currentSeed = seed;
  const getNext = () => {
    let x = Math.sin(currentSeed++) * 10000;
    return x - Math.floor(x);
  };
  
  const isProtected = (x: number, y: number) => {
    return protectedPoints.some(p => Math.floor(p.x) === x && Math.floor(p.y) === y);
  };

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      // Avoid start area and protected points
      if ((x < 4 && y < 4) || isProtected(x, y)) continue;
      
      // Use deterministic random - increased density from 0.2 to 0.3
      if (getNext() < 0.25) { // Slightly lower density for dynamic maps to ensure connectivity
        grid[y][x] = 1;
      }
    }
  }
  
  // Ensure some corridors for movement
  for (let i = 0; i < GRID_SIZE; i++) {
    if (i % 6 === 0) {
      for (let j = 0; j < GRID_SIZE; j++) {
        if (!isProtected(j, i)) grid[i][j] = 0;
        if (!isProtected(i, j)) grid[j][i] = 0;
      }
    }
  }

  // Ensure connectivity - flood fill from (0,0)
  const reachable = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(false));
  const queue: [number, number][] = [[0, 0]];
  reachable[0][0] = true;

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    const neighbors = [
      [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE && !reachable[ny][nx] && grid[ny][nx] === 0) {
        reachable[ny][nx] = true;
        queue.push([nx, ny]);
      }
    }
  }

  // Turn unreachable 0s into walls (1s) to prevent data from spawning in closed shapes
  // BUT don't block protected points
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y][x] === 0 && !reachable[y][x] && !isProtected(x, y)) {
        grid[y][x] = 1;
      }
    }
  }
  
  return grid;
};

const generateStaticGrid = (seed: number) => generateDynamicGrid(seed);

export const MAPS: GameMap[] = [
  { name: 'SECTOR_ALPHA', description: 'HIGH_DENSITY_CORE // STABLE', grid: generateStaticGrid(101) },
  { name: 'SECTOR_BETA', description: 'PERIPHERAL_HUB // UNSTABLE', grid: generateStaticGrid(202) },
  { name: 'SECTOR_GAMMA', description: 'DATA_VAULT // SECURE', grid: generateStaticGrid(303) },
  { name: 'SECTOR_DELTA', description: 'VOID_RUNNER // CRITICAL', grid: generateStaticGrid(404) },
  { name: 'SECTOR_EPSILON', description: 'NEON_GRID // ACTIVE', grid: generateStaticGrid(505) },
  { name: 'SECTOR_ZETA', description: 'SHADOW_REALM // UNKNOWN', grid: generateStaticGrid(606) },
];

export const CHANGING_MAZE_MAP: GameMap = {
  name: 'DYNAMIC_SECTOR_X',
  description: 'UNSTABLE_TOPOLOGY // SHIFTING_WALLS',
  grid: generateStaticGrid(707)
};

export const HARD_MODE_MAP: GameMap = {
  name: 'BLACK_OPS_SECTOR',
  description: 'MAXIMUM_SECURITY // PRO_SEEKERS',
  grid: generateStaticGrid(808)
};
