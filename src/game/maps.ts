import { GRID_SIZE } from './types';

export interface GameMap {
  name: string;
  grid: number[][];
  description: string;
}

const createEmptyGrid = () => Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));

const generateGrid01 = () => {
  const grid = createEmptyGrid();
  // Classic Grid/Pillars
  for (let y = 0; y < GRID_SIZE; y += 3) {
    for (let x = 0; x < GRID_SIZE; x += 3) {
      if (x < 5 && y < 5) continue;
      grid[y][x] = 1;
    }
  }
  return grid;
};

const generateGrid02 = () => {
  const grid = createEmptyGrid();
  // The Cross
  for (let i = 0; i < GRID_SIZE; i++) {
    if (i < 10 || i > 20) {
      grid[i][GRID_SIZE / 2] = 1;
      grid[GRID_SIZE / 2][i] = 1;
    }
  }
  // Scattered blocks
  for (let i = 0; i < 40; i++) {
    const x = Math.floor((i * 7) % GRID_SIZE);
    const y = Math.floor((i * 13) % GRID_SIZE);
    if (x < 5 && y < 5) continue;
    grid[y][x] = 1;
  }
  return grid;
};

const generateGrid03 = () => {
  const grid = createEmptyGrid();
  // Perimeter Labyrinth
  for (let i = 0; i < GRID_SIZE; i++) {
    grid[0][i] = 1;
    grid[GRID_SIZE - 1][i] = 1;
    grid[i][0] = 1;
    grid[i][GRID_SIZE - 1] = 1;
  }
  // Inner walls
  for (let i = 5; i < GRID_SIZE - 5; i += 5) {
    for (let j = 5; j < GRID_SIZE - 5; j++) {
      if (i % 10 === 0) {
        if (j < GRID_SIZE - 10) grid[i][j] = 1;
      } else {
        if (j > 10) grid[i][j] = 1;
      }
    }
  }
  return grid;
};

const generateGrid04 = () => {
  const grid = createEmptyGrid();
  // Diamond Pattern
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (x < 5 && y < 5) continue;
      if ((x + y) % 6 === 0 || (x - y) % 6 === 0) {
        if (Math.abs(x - GRID_SIZE/2) + Math.abs(y - GRID_SIZE/2) > 5) {
          grid[y][x] = 1;
        }
      }
    }
  }
  return grid;
};

const generateGrid05 = () => {
  const grid = createEmptyGrid();
  // The Fortress
  for (let y = 10; y < 20; y++) {
    for (let x = 10; x < 20; x++) {
      if (x === 10 || x === 19 || y === 10 || y === 19) {
        if (!(x === 15 || y === 15)) grid[y][x] = 1;
      }
    }
  }
  // Outer defensive lines
  for (let i = 0; i < GRID_SIZE; i += 4) {
    grid[i][5] = 1;
    grid[5][i] = 1;
    grid[i][25] = 1;
    grid[25][i] = 1;
  }
  return grid;
};

const generateGrid06 = () => {
  const grid = createEmptyGrid();
  // Chaos Theory (Deterministic Random-ish)
  for (let i = 0; i < 150; i++) {
    const x = (i * 17) % GRID_SIZE;
    const y = (i * 23) % GRID_SIZE;
    if (x < 6 && y < 6) continue;
    grid[y][x] = 1;
    if (i % 5 === 0 && x < GRID_SIZE - 1) grid[y][x+1] = 1;
  }
  return grid;
};

export const MAPS: GameMap[] = [
  {
    name: "ARENA_01: GRID_PROTOCOL",
    grid: generateGrid01(),
    description: "Standard testing environment. Symmetrical pillars provide basic cover."
  },
  {
    name: "ARENA_02: THE_CROSSING",
    grid: generateGrid02(),
    description: "High-visibility sector. Central corridors are dangerous but efficient."
  },
  {
    name: "ARENA_03: PERIMETER_LOCK",
    grid: generateGrid03(),
    description: "Confined labyrinth. Narrow corridors favor stealth over speed."
  },
  {
    name: "ARENA_04: DIAMOND_NODE",
    grid: generateGrid04(),
    description: "Complex geometry. Visibility is fragmented across multiple vectors."
  },
  {
    name: "ARENA_05: THE_FORTRESS",
    grid: generateGrid05(),
    description: "Centralized data core. Highly defensible inner sanctum."
  },
  {
    name: "ARENA_06: CHAOS_SECTOR",
    grid: generateGrid06(),
    description: "Unpredictable terrain. Debris and structural failure provide organic cover."
  }
];
