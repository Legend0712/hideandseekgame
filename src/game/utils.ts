import { Point, GRID_SIZE } from './types';

export class Node {
  constructor(
    public x: number,
    public y: number,
    public g: number = 0,
    public h: number = 0,
    public parent: Node | null = null
  ) {}

  get f(): number {
    return this.g + this.h;
  }
}

export function heuristic(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function aStar(start: Point, end: Point, grid: number[][]): Point[] {
  const openList: Node[] = [new Node(start.x, start.y, 0, heuristic(start, end))];
  const closedList: Set<string> = new Set();

  while (openList.length > 0) {
    // Get node with lowest f
    let currentIndex = 0;
    for (let i = 1; i < openList.length; i++) {
      if (openList[i].f < openList[currentIndex].f) {
        currentIndex = i;
      }
    }

    const current = openList.splice(currentIndex, 1)[0];
    closedList.add(`${current.x},${current.y}`);

    // Found the goal
    if (current.x === end.x && current.y === end.y) {
      const path: Point[] = [];
      let temp: Node | null = current;
      while (temp) {
        path.push({ x: temp.x, y: temp.y });
        temp = temp.parent;
      }
      return path.reverse();
    }

    // Neighbors
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];

    for (const neighbor of neighbors) {
      if (
        neighbor.x < 0 || neighbor.x >= GRID_SIZE ||
        neighbor.y < 0 || neighbor.y >= GRID_SIZE ||
        grid[neighbor.y][neighbor.x] === 1 ||
        closedList.has(`${neighbor.x},${neighbor.y}`)
      ) {
        continue;
      }

      const gScore = current.g + 1;
      let neighborNode = openList.find(n => n.x === neighbor.x && n.y === neighbor.y);

      if (!neighborNode) {
        neighborNode = new Node(neighbor.x, neighbor.y, gScore, heuristic(neighbor, end), current);
        openList.push(neighborNode);
      } else if (gScore < neighborNode.g) {
        neighborNode.g = gScore;
        neighborNode.parent = current;
      }
    }
  }

  return []; // No path found
}

export function hasLineOfSight(start: Point, end: Point, grid: number[][], radius: number): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > radius) return false;

  // Check multiple points on the target to prevent corner-clipping detection
  const offsets = [
    { x: 0, y: 0 },
    { x: 0.25, y: 0.25 },
    { x: -0.25, y: 0.25 },
    { x: 0.25, y: -0.25 },
    { x: -0.25, y: -0.25 },
  ];

  for (const offset of offsets) {
    const targetX = end.x + offset.x;
    const targetY = end.y + offset.y;
    const tdx = targetX - start.x;
    const tdy = targetY - start.y;
    const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
    
    const steps = Math.ceil(tdist * 15); // Increased steps
    let blocked = false;
    
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = start.x + tdx * t;
      const py = start.y + tdy * t;
      
      // Check a small radius around each point to avoid grazing corners
      const checkPoints = [
        { x: px, y: py },
        { x: px + 0.05, y: py + 0.05 },
        { x: px - 0.05, y: py + 0.05 },
        { x: px + 0.05, y: py - 0.05 },
        { x: px - 0.05, y: py - 0.05 },
      ];

      for (const cp of checkPoints) {
        const gx = Math.floor(cp.x);
        const gy = Math.floor(cp.y);
        
        if (
          gx < 0 || gx >= GRID_SIZE ||
          gy < 0 || gy >= GRID_SIZE ||
          grid[gy][gx] === 1
        ) {
          blocked = true;
          break;
        }

        // Diagonal corner check: if we are very close to an intersection
        const fx = cp.x - gx;
        const fy = cp.y - gy;
        const margin = 0.1;
        
        if (fx < margin && fy < margin && gx > 0 && gy > 0) {
          if (grid[gy-1][gx-1] === 1 && grid[gy][gx] === 1) { blocked = true; break; }
          if (grid[gy-1][gx] === 1 && grid[gy][gx-1] === 1) { blocked = true; break; }
        }
        if (fx > 1 - margin && fy < margin && gx < GRID_SIZE - 1 && gy > 0) {
          if (grid[gy-1][gx+1] === 1 && grid[gy][gx] === 1) { blocked = true; break; }
          if (grid[gy-1][gx] === 1 && grid[gy][gx+1] === 1) { blocked = true; break; }
        }
        if (fx < margin && fy > 1 - margin && gx > 0 && gy < GRID_SIZE - 1) {
          if (grid[gy+1][gx-1] === 1 && grid[gy][gx] === 1) { blocked = true; break; }
          if (grid[gy+1][gx] === 1 && grid[gy][gx-1] === 1) { blocked = true; break; }
        }
        if (fx > 1 - margin && fy > 1 - margin && gx < GRID_SIZE - 1 && gy < GRID_SIZE - 1) {
          if (grid[gy+1][gx+1] === 1 && grid[gy][gx] === 1) { blocked = true; break; }
          if (grid[gy+1][gx] === 1 && grid[gy+1][gx] === 1) { /* already checked? */ }
          if (grid[gy+1][gx] === 1 && grid[gy][gx+1] === 1) { blocked = true; break; }
        }
      }
      if (blocked) break;
    }
    
    if (!blocked) return true;
  }

  return false;
}

export function getVisibilityPolygon(origin: Point, grid: number[][], radius: number): Point[] {
  const points: Point[] = [];
  const resolution = 120; // Reduced resolution for performance
  
  for (let i = 0; i < resolution; i++) {
    const angle = (i * Math.PI * 2) / resolution;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    
    let hit = false;
    for (let d = 0; d < radius; d += 0.05) {
      const px = origin.x + dx * d;
      const py = origin.y + dy * d;
      const gx = Math.floor(px);
      const gy = Math.floor(py);
      
      if (
        gx < 0 || gx >= GRID_SIZE ||
        gy < 0 || gy >= GRID_SIZE ||
        grid[gy][gx] === 1
      ) {
        points.push({ x: px, y: py });
        hit = true;
        break;
      }
    }
    
    if (!hit) {
      points.push({ x: origin.x + dx * radius, y: origin.y + dy * radius });
    }
  }
  
  return points;
}

export function generateGrid(): number[][] {
  const grid: number[][] = Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(0));

  // Add some walls
  for (let i = 0; i < GRID_SIZE; i++) {
    for (let j = 0; j < GRID_SIZE; j++) {
      if (Math.random() < 0.2) {
        grid[i][j] = 1;
      }
    }
  }

  // Ensure start and some space is clear
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      grid[i][j] = 0;
    }
  }

  return grid;
}
