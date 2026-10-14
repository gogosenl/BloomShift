export type Direction = 1 | -1;
export type BoardSize = 3 | 4 | 5 | 6;
export type GridDimension = 2 | BoardSize;
export type Difficulty = "easy" | "medium" | "hard";

export type Move = {
  row: number;
  col: number;
  direction: Direction;
};

export type BoardLayout = {
  id: string;
  rows: GridDimension;
  cols: GridDimension;
  size: BoardSize;
  total: number;
};

export type Level = {
  globalIndex: number;
  number: number;
  layerTotal: number;
  size: BoardSize;
  rows: GridDimension;
  cols: GridDimension;
  layoutId: string;
  difficulty: Difficulty;
  colorCount: number;
  name: string;
  target: number[];
  initial: number[];
  solution: Move[];
  par: number;
};

export const LAYER_CONFIGS: BoardLayout[] = [
  { id: "3x3", cols: 3, rows: 3, size: 3, total: 50 },
  { id: "4x3", cols: 4, rows: 3, size: 4, total: 50 },
  { id: "4x4", cols: 4, rows: 4, size: 4, total: 50 },
  { id: "5x4", cols: 5, rows: 4, size: 5, total: 50 },
  { id: "5x5", cols: 5, rows: 5, size: 5, total: 50 },
  { id: "6x5", cols: 6, rows: 5, size: 6, total: 50 },
  { id: "6x6", cols: 6, rows: 6, size: 6, total: 50 },
];

export const WARMUP_LAYOUT: BoardLayout = {
  id: "2x3-warmup",
  cols: 2,
  rows: 3,
  size: 3,
  total: 3,
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Kolay",
  medium: "Orta",
  hard: "Zor",
};

const DIFFICULTY_INDEX: Record<Difficulty, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

export function levelKey(
  level: Pick<Level, "rows" | "cols" | "difficulty" | "number">
) {
  return `${level.difficulty}-${level.cols}x${level.rows}-${level.number}`;
}

export function sameBoard(a: number[], b: number[]) {
  return (
    a.length === b.length &&
    a.every((value, index) => value === b[index])
  );
}

export function sameMove(a: Move, b: Move) {
  return a.row === b.row && a.col === b.col && a.direction === b.direction;
}

export function rotateGroup(
  board: number[],
  columns: number,
  row: number,
  col: number,
  direction: Direction
) {
  const next = [...board];
  const topLeft = row * columns + col;
  const topRight = topLeft + 1;
  const bottomLeft = (row + 1) * columns + col;
  const bottomRight = bottomLeft + 1;

  if (direction === 1) {
    next[topRight] = board[topLeft];
    next[bottomRight] = board[topRight];
    next[bottomLeft] = board[bottomRight];
    next[topLeft] = board[bottomLeft];
  } else {
    next[bottomLeft] = board[topLeft];
    next[bottomRight] = board[bottomLeft];
    next[topRight] = board[bottomRight];
    next[topLeft] = board[topRight];
  }

  return next;
}

function seededRandom(seed: number) {
  let value = Math.max(1, seed % 2147483647);
  return () => {
    value = (value * 48271) % 2147483647;
    return value / 2147483647;
  };
}

function balancedColorCounts(cellCount: number, colorCount: number) {
  const base = Math.floor(cellCount / colorCount);
  const remainder = cellCount % colorCount;
  return Array.from(
    { length: colorCount },
    (_, color) => base + (color < remainder ? 1 : 0)
  );
}

function steppedColorDistributions(cellCount: number, colorCount: number) {
  const balanced = balancedColorCounts(cellCount, colorCount);
  const current = [
    cellCount - (colorCount - 1),
    ...Array(colorCount - 1).fill(1),
  ];
  const plans: number[][] = [];
  let incrementCursor = 1;

  function pushPlan(counts: number[], repeat: number) {
    for (let index = 0; index < repeat; index += 1) {
      plans.push([...counts]);
    }
  }

  while (current.some((count, index) => count !== balanced[index])) {
    pushPlan(current, 3);
    let targetColor = incrementCursor;
    for (let attempt = 0; attempt < colorCount - 1; attempt += 1) {
      const candidate = ((incrementCursor - 1 + attempt) % (colorCount - 1)) + 1;
      if (current[candidate] < balanced[candidate]) {
        targetColor = candidate;
        break;
      }
    }
    if (current[targetColor] >= balanced[targetColor]) break;
    current[0] -= 1;
    current[targetColor] += 1;
    incrementCursor = (targetColor % (colorCount - 1)) + 1;
  }

  pushPlan(balanced, 5);
  return plans;
}

function levelCountFor(
  rows: number,
  cols: number,
  difficulty: Difficulty
) {
  return steppedColorDistributions(
    rows * cols,
    colorsFor(rows, cols, difficulty)
  ).length;
}

function colorCountsForLevel(
  rows: number,
  cols: number,
  difficulty: Difficulty,
  number: number
) {
  const distributions = steppedColorDistributions(
    rows * cols,
    colorsFor(rows, cols, difficulty)
  );
  return distributions[
    Math.min(number - 1, distributions.length - 1)
  ];
}

function anchorSetFor(colorCount: number) {
  const anchorSets: Record<number, Array<[number, number]>> = {
    2: [[0.5, 0.05], [0.5, 0.95]],
    3: [[0.06, 0.08], [0.92, 0.5], [0.08, 0.92]],
    4: [[0.06, 0.06], [0.06, 0.94], [0.94, 0.06], [0.94, 0.94]],
    5: [[0.06, 0.06], [0.06, 0.94], [0.5, 0.5], [0.94, 0.06], [0.94, 0.94]],
    6: [[0.06, 0.06], [0.06, 0.94], [0.5, 0.08], [0.5, 0.92], [0.94, 0.06], [0.94, 0.94]],
  };
  return anchorSets[colorCount] ?? anchorSets[4];
}

function createClusteredTarget(
  rows: number,
  cols: number,
  colorCount: number,
  number: number,
  counts: number[]
) {
  const anchors = anchorSetFor(colorCount);
  const colorShift = Math.floor((number - 1) / 5) % colorCount;
  const mirror = Math.floor((number - 1) / colorCount) % 2;
  const target = Array(rows * cols).fill(-1);
  const remaining = [...counts];
  const cells = Array.from({ length: rows * cols }, (_, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const rowRatio = rows === 1 ? 0 : row / (rows - 1);
    const colRatio = cols === 1 ? 0 : col / (cols - 1);
    const sampleCol = mirror ? 1 - colRatio : colRatio;
    const preferences = anchors
      .map(([anchorRow, anchorCol], color) => {
        const rowDistance = rowRatio - anchorRow;
        const colDistance = sampleCol - anchorCol;
        return {
          color: (color + colorShift) % colorCount,
          distance: rowDistance * rowDistance + colDistance * colDistance,
        };
      })
      .sort((a, b) => a.distance - b.distance);
    return { index, nearestDistance: preferences[0].distance, preferences };
  });
  cells.sort((a, b) => a.nearestDistance - b.nearestDistance);

  cells.forEach((cell) => {
    const selected =
      cell.preferences.find(({ color }) => remaining[color] > 0)?.color ?? 0;
    target[cell.index] = selected;
    remaining[selected] -= 1;
  });

  return target;
}

function createConnectedTarget(
  rows: number,
  cols: number,
  colorCount: number,
  random: () => number
) {
  const cellCount = rows * cols;
  const target = Array(cellCount).fill(-1);
  const cellsByColor: number[][] = Array.from(
    { length: colorCount },
    () => []
  );
  const occupied = new Set<number>();

  for (let color = 0; color < colorCount; color += 1) {
    let position = Math.floor(random() * cellCount);
    while (occupied.has(position)) {
      position = (position + 1) % cellCount;
    }
    occupied.add(position);
    target[position] = color;
    cellsByColor[color].push(position);
  }

  while (target.some((color) => color === -1)) {
    const availableByColor = cellsByColor.map((cells) => {
      const available = new Set<number>();
      cells.forEach((position) => {
        const row = Math.floor(position / cols);
        const col = position % cols;
        const neighbors = [
          [row - 1, col],
          [row + 1, col],
          [row, col - 1],
          [row, col + 1],
        ];
        neighbors.forEach(([nextRow, nextCol]) => {
          if (
            nextRow >= 0 &&
            nextRow < rows &&
            nextCol >= 0 &&
            nextCol < cols
          ) {
            const nextPosition = nextRow * cols + nextCol;
            if (target[nextPosition] === -1) available.add(nextPosition);
          }
        });
      });
      return [...available];
    });

    const expandable = availableByColor
      .map((available, color) => ({ color, available }))
      .filter(({ available }) => available.length > 0);
    const smallest = Math.min(
      ...expandable.map(({ color }) => cellsByColor[color].length)
    );
    const balanced = expandable.filter(
      ({ color }) => cellsByColor[color].length <= smallest + 1
    );
    const selected = balanced[Math.floor(random() * balanced.length)];
    const position =
      selected.available[Math.floor(random() * selected.available.length)];
    target[position] = selected.color;
    cellsByColor[selected.color].push(position);
  }

  return target;
}

function mixTarget(
  target: number[],
  swapCount: number,
  random: () => number
) {
  const mixed = [...target];
  for (let swap = 0; swap < swapCount; swap += 1) {
    const first = Math.floor(random() * mixed.length);
    let second = Math.floor(random() * mixed.length);
    let attempts = 0;
    while (mixed[first] === mixed[second] && attempts < mixed.length) {
      second = (second + 1) % mixed.length;
      attempts += 1;
    }
    if (mixed[first] !== mixed[second]) {
      [mixed[first], mixed[second]] = [mixed[second], mixed[first]];
    }
  }
  return mixed;
}

function createTarget(
  rows: number,
  cols: number,
  number: number,
  difficulty: Difficulty,
  colorCount: number,
  random: () => number
) {
  const counts = colorCountsForLevel(rows, cols, difficulty, number);
  const clustered = createClusteredTarget(
    rows,
    cols,
    colorCount,
    number,
    counts
  );
  if (difficulty === "easy") {
    return clustered;
  }

  const progress = (number - 1) / 49;
  const ratio =
    difficulty === "medium"
      ? 0.08 + progress * 0.14
      : 0.28 + progress * 0.3;
  return mixTarget(
    clustered,
    Math.max(
      difficulty === "hard" ? 5 : 2,
      Math.round(clustered.length * ratio)
    ),
    random
  );
}

function colorsFor(
  rows: number,
  cols: number,
  difficulty: Difficulty
) {
  let easyColorCount = 4;
  if ((cols === 3 && rows === 3) || (cols === 4 && rows === 3)) {
    easyColorCount = 2;
  } else if (
    (cols === 4 && rows === 4) ||
    (cols === 5 && rows === 4)
  ) {
    easyColorCount = 3;
  }

  const difficultyBonus =
    difficulty === "easy" ? 0 : difficulty === "medium" ? 1 : 2;
  return Math.min(6, easyColorCount + difficultyBonus);
}

function scrambleLength(
  rows: number,
  cols: number,
  number: number,
  difficulty: Difficulty
) {
  const progress = (number - 1) / 49;
  const shapeComplexity = rows + cols - 6;
  if (difficulty === "easy") {
    return 4 + Math.ceil(shapeComplexity / 2) + Math.floor(progress * 11);
  }
  if (difficulty === "medium") {
    return 12 + shapeComplexity * 2 + Math.floor(progress * 20);
  }
  return 22 + shapeComplexity * 3 + Math.floor(progress * 34);
}

function makeLevel(
  layout: BoardLayout,
  difficulty: Difficulty,
  number: number,
  globalIndex: number,
  variation = 0
): Level {
  const { rows, cols, size, id: layoutId } = layout;
  const total = levelCountFor(rows, cols, difficulty);
  const colorCount = colorsFor(rows, cols, difficulty);
  const random = seededRandom(
    cols * 1000003 +
      rows * 100003 +
      number * 7919 +
      DIFFICULTY_INDEX[difficulty] * 15485863 +
      variation * 32452843
  );
  const target = createTarget(
    rows,
    cols,
    number,
    difficulty,
    colorCount,
    random
  );
  const desiredMoves = scrambleLength(rows, cols, number, difficulty);
  const scramble: Move[] = [];
  const seenBoards = new Set<string>([target.join("")]);
  let current = [...target];
  let attempts = 0;

  while (scramble.length < desiredMoves && attempts < desiredMoves * 220) {
    attempts += 1;
    const move: Move = {
      row: Math.floor(random() * (rows - 1)),
      col: Math.floor(random() * (cols - 1)),
      direction: random() > 0.5 ? 1 : -1,
    };
    const previous = scramble[scramble.length - 1];
    if (
      previous &&
      previous.row === move.row &&
      previous.col === move.col &&
      previous.direction === -move.direction
    ) {
      continue;
    }

    const changed = rotateGroup(
      current,
      cols,
      move.row,
      move.col,
      move.direction
    );
    const signature = changed.join("");
    if (sameBoard(changed, current) || seenBoards.has(signature)) continue;
    current = changed;
    seenBoards.add(signature);
    scramble.push(move);
  }

  if (sameBoard(current, target)) {
    outer: for (let row = 0; row < rows - 1; row += 1) {
      for (let col = 0; col < cols - 1; col += 1) {
        const changed = rotateGroup(current, cols, row, col, 1);
        if (!sameBoard(changed, current)) {
          current = changed;
          scramble.push({ row, col, direction: 1 });
          break outer;
        }
      }
    }
  }

  const solution = [...scramble].reverse().map((move) => ({
    ...move,
    direction: -move.direction as Direction,
  }));
  const prefix =
    difficulty === "easy"
      ? "Sakin Bahçe"
      : difficulty === "medium"
        ? "Renk Akışı"
        : "Karma Dalga";

  return {
    globalIndex,
    number,
    layerTotal: total,
    size,
    rows,
    cols,
    layoutId,
    difficulty,
    colorCount,
    name: `${prefix} ${number}`,
    target,
    initial: current,
    solution,
    par: solution.length,
  };
}

const WARMUP_TARGETS = [
  [0, 1, 0, 1, 0, 1],
  [0, 0, 0, 1, 1, 1],
  [0, 0, 1, 0, 1, 1],
] as const;

const WARMUP_SCRAMBLES: Move[][] = [
  [{ row: 0, col: 0, direction: 1 }],
  [{ row: 0, col: 0, direction: 1 }],
  [{ row: 0, col: 0, direction: 1 }],
];

function makeWarmupLevel(number: number, globalIndex: number): Level {
  const target: number[] = [
    ...WARMUP_TARGETS[(number - 1) % WARMUP_TARGETS.length],
  ];
  const scramble = WARMUP_SCRAMBLES[number - 1];
  const initial = scramble.reduce<number[]>(
    (current, move) =>
      rotateGroup(current, WARMUP_LAYOUT.cols, move.row, move.col, move.direction),
    target
  );
  const solution = [...scramble].reverse().map((move) => ({
    ...move,
    direction: -move.direction as Direction,
  }));

  return {
    globalIndex,
    number,
    layerTotal: WARMUP_LAYOUT.total,
    size: WARMUP_LAYOUT.size,
    rows: WARMUP_LAYOUT.rows,
    cols: WARMUP_LAYOUT.cols,
    layoutId: WARMUP_LAYOUT.id,
    difficulty: "easy",
    colorCount: 2,
    name: `Isınma Turu ${number}`,
    target,
    initial,
    solution,
    par: solution.length,
  };
}

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
let globalIndex = 0;

const WARMUP_LEVELS = Array.from(
  { length: WARMUP_LAYOUT.total },
  (_, index) => makeWarmupLevel(index + 1, globalIndex++)
);

const STANDARD_LEVELS = DIFFICULTIES.flatMap((difficulty) =>
  LAYER_CONFIGS.flatMap((layout) => {
    const usedInitialBoards = new Set<string>();
    const total = levelCountFor(layout.rows, layout.cols, difficulty);
    return Array.from({ length: total }, (_, index) => {
      let variation = 0;
      let level = makeLevel(
        layout,
        difficulty,
        index + 1,
        globalIndex,
        variation
      );
      while (
        usedInitialBoards.has(level.initial.join(",")) &&
        variation < 80
      ) {
        variation += 1;
        level = makeLevel(
          layout,
          difficulty,
          index + 1,
          globalIndex,
          variation
        );
      }
      usedInitialBoards.add(level.initial.join(","));
      globalIndex += 1;
      return level;
    });
  })
);

export const LEVELS = [...WARMUP_LEVELS, ...STANDARD_LEVELS];

export type ProgressionGroup = {
  id: string;
  size: BoardSize;
  rows: GridDimension;
  cols: GridDimension;
  layoutId: string;
  difficulty: Difficulty;
  title: string;
  modeLabel: string;
  unlockCost: number;
  levels: Level[];
};

const GROUP_ORDER = DIFFICULTIES.flatMap((difficulty) =>
  LAYER_CONFIGS.map((layout) => ({ difficulty, layout }))
);

const WARMUP_GROUP: ProgressionGroup = {
  id: "warmup-2x3",
  size: WARMUP_LAYOUT.size,
  rows: WARMUP_LAYOUT.rows,
  cols: WARMUP_LAYOUT.cols,
  layoutId: WARMUP_LAYOUT.id,
  difficulty: "easy",
  title: "Isınma Turu",
  modeLabel: "Isınma",
  unlockCost: 0,
  levels: WARMUP_LEVELS,
};

export const PROGRESSION_GROUPS: ProgressionGroup[] = [
  WARMUP_GROUP,
  ...GROUP_ORDER.map(({ difficulty, layout }, index) => {
    const levels = LEVELS.filter(
      (level) =>
        level.rows === layout.rows &&
        level.cols === layout.cols &&
        level.difficulty === difficulty
    );
    const previousGroupLevels =
      index === 0
        ? WARMUP_LEVELS.length
        : LEVELS.filter((level) => {
            const previous = GROUP_ORDER[index - 1];
            return (
              level.rows === previous.layout.rows &&
              level.cols === previous.layout.cols &&
              level.difficulty === previous.difficulty
            );
          }).length;

    return {
      id: `${difficulty}-${layout.id}`,
      size: layout.size,
      rows: layout.rows,
      cols: layout.cols,
      layoutId: layout.id,
      difficulty,
      title: `${layout.cols}×${layout.rows} ${DIFFICULTY_LABELS[difficulty]}`,
      modeLabel: DIFFICULTY_LABELS[difficulty],
      unlockCost: index === 0 ? 0 : Math.max(0, previousGroupLevels - 10),
      levels,
    };
  }),
];

export function progressionGroupForLevel(
  level: Pick<Level, "rows" | "cols" | "difficulty">
) {
  return PROGRESSION_GROUPS.find(
    (group) =>
      group.rows === level.rows &&
      group.cols === level.cols &&
      group.difficulty === level.difficulty
  )!;
}

export function numberInProgressionGroup(level: Pick<Level, "number">) {
  return level.number;
}

export function isWarmupLevel(level: Pick<Level, "layoutId">) {
  return level.layoutId === WARMUP_LAYOUT.id;
}

export function isWarmupGroup(group: Pick<ProgressionGroup, "layoutId">) {
  return group.layoutId === WARMUP_LAYOUT.id;
}
