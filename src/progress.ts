import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Difficulty,
  LEVELS,
  PROGRESSION_GROUPS,
  levelKey,
} from "./game";

const SAVE_KEY = "dalga-bahcesi.progress.v1";
export const SAVE_SCHEMA_VERSION = 8;

export type AppLanguage = "tr" | "en";

export type LevelResult = {
  stars: number;
  bestMoves: number;
  completedAt: string;
};

export type PurchaseRecord = {
  id: string;
  productId: string;
  title: string;
  price: string;
  purchasedAt: string;
};

export type PlayerProgress = {
  schemaVersion: number;
  results: Record<string, LevelResult>;
  hintCoins: number;
  layerCoins: number;
  freeHints: number;
  paidHintConfirmed: boolean;
  unlockedGroupIds: string[];
  hapticsEnabled: boolean;
  musicEnabled: boolean;
  soundEnabled: boolean;
  language: AppLanguage;
  languageChosen: boolean;
  currentLevelKey: string;
  tutorialCompleted: boolean;
  adsRemoved: boolean;
  purchaseHistory: PurchaseRecord[];
  processedTransactionIds: string[];
};

export const INITIAL_FREE_HINTS = 3;

export const DEFAULT_PROGRESS: PlayerProgress = {
  schemaVersion: SAVE_SCHEMA_VERSION,
  results: {},
  hintCoins: 0,
  layerCoins: 0,
  freeHints: INITIAL_FREE_HINTS,
  paidHintConfirmed: false,
  unlockedGroupIds: [
    PROGRESSION_GROUPS[0].id,
    PROGRESSION_GROUPS[1].id,
  ],
  hapticsEnabled: true,
  musicEnabled: true,
  soundEnabled: true,
  language: "en",
  languageChosen: false,
  currentLevelKey: levelKey(LEVELS[0]),
  tutorialCompleted: false,
  adsRemoved: false,
  purchaseHistory: [],
  processedTransactionIds: [],
};

export function normalizeProgress(value: unknown): PlayerProgress {
  if (!value || typeof value !== "object") return DEFAULT_PROGRESS;
  const raw = value as Partial<PlayerProgress> & { petals?: number };
  const resetProgressionLocks =
    raw.schemaVersion !== SAVE_SCHEMA_VERSION;
  const validKeys = new Set(LEVELS.map(levelKey));
  const results: Record<string, LevelResult> = {};

  if (
    !resetProgressionLocks &&
    raw.results &&
    typeof raw.results === "object"
  ) {
    Object.entries(raw.results).forEach(([savedKey, result]) => {
      let key = savedKey;
      const legacyMatch = /^([3-6])-(\d+)$/.exec(savedKey);
      if (legacyMatch) {
        const size = Number(legacyMatch[1]);
        const oldNumber = Number(legacyMatch[2]);
        const difficulty =
          oldNumber <= 50 ? "easy" : oldNumber <= 100 ? "medium" : "hard";
        const localNumber = ((oldNumber - 1) % 50) + 1;
        key = `${difficulty}-${size}x${size}-${localNumber}`;
      }
      if (
        validKeys.has(key) &&
        result &&
        typeof result.stars === "number" &&
        typeof result.bestMoves === "number"
      ) {
        results[key] = {
          stars: Math.max(1, Math.min(3, Math.round(result.stars))),
          bestMoves: Math.max(1, Math.round(result.bestMoves)),
          completedAt:
            typeof result.completedAt === "string"
              ? result.completedAt
              : new Date().toISOString(),
        };
      }
    });
  }

  const savedUnlockedGroups =
    !resetProgressionLocks && Array.isArray(raw.unlockedGroupIds)
    ? raw.unlockedGroupIds
        .map((id) => {
          const legacyMatch = /^(easy|medium|hard)-([3-6])$/.exec(id);
          return legacyMatch
            ? `${legacyMatch[1]}-${legacyMatch[2]}x${legacyMatch[2]}`
            : id;
        })
        .filter((id) =>
          PROGRESSION_GROUPS.some((group) => group.id === id)
        )
    : [];
  const savedUnlockedSet = new Set(savedUnlockedGroups);
  const unlockedGroupIds = PROGRESSION_GROUPS.reduce<string[]>(
    (unlocked, group, index) => {
      if (index <= 1) {
        unlocked.push(group.id);
        return unlocked;
      }
      if (
        unlocked[index - 1] === PROGRESSION_GROUPS[index - 1].id &&
        savedUnlockedSet.has(group.id)
      ) {
        unlocked.push(group.id);
      }
      return unlocked;
    },
    []
  );
  const savedCurrentLevel =
    !resetProgressionLocks &&
    typeof raw.currentLevelKey === "string"
      ? LEVELS.find((level) => levelKey(level) === raw.currentLevelKey)
      : undefined;
  const savedCurrentGroup = savedCurrentLevel
    ? PROGRESSION_GROUPS.find((group) =>
        group.levels.some(
          (level) => levelKey(level) === levelKey(savedCurrentLevel)
        )
      )
    : undefined;
  const inferredCurrentLevel = [...PROGRESSION_GROUPS]
    .reverse()
    .filter((group) => unlockedGroupIds.includes(group.id))
    .map(
      (group) =>
        group.levels.find((level, index) => {
          if (results[levelKey(level)]) return false;
          return index === 0 || Boolean(results[levelKey(group.levels[index - 1])]);
        }) ?? group.levels[group.levels.length - 1]
    )[0] ?? LEVELS[0];
  const purchaseHistory = Array.isArray(raw.purchaseHistory)
    ? raw.purchaseHistory
        .filter(
          (record): record is PurchaseRecord =>
            Boolean(record) &&
            typeof record.id === "string" &&
            typeof record.productId === "string" &&
            typeof record.title === "string" &&
            typeof record.price === "string" &&
            typeof record.purchasedAt === "string"
        )
        .slice(0, 100)
    : [];
  const processedTransactionIds = Array.isArray(raw.processedTransactionIds)
    ? raw.processedTransactionIds
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        .slice(0, 250)
    : [];

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    results,
    hintCoins:
      typeof raw.hintCoins === "number"
        ? Math.max(0, Math.round(raw.hintCoins))
        : typeof raw.petals === "number"
          ? Math.max(0, Math.round(raw.petals))
          : DEFAULT_PROGRESS.hintCoins,
    layerCoins:
      typeof raw.layerCoins === "number"
        ? Math.max(0, Math.round(raw.layerCoins))
        : DEFAULT_PROGRESS.layerCoins,
    freeHints:
      typeof raw.freeHints === "number"
        ? Math.max(0, Math.round(raw.freeHints))
        : DEFAULT_PROGRESS.freeHints,
    paidHintConfirmed: raw.paidHintConfirmed === true,
    unlockedGroupIds,
    hapticsEnabled: raw.hapticsEnabled !== false,
    musicEnabled: raw.musicEnabled !== false,
    soundEnabled: raw.soundEnabled !== false,
    language: raw.language === "tr" ? "tr" : "en",
    // Existing saves already have an established language preference.
    languageChosen:
      typeof raw.languageChosen === "boolean"
        ? raw.languageChosen
        : true,
    // When the level structure changes, restart at the new warm-up flow so
    // old saves cannot skip the redesigned onboarding levels.
    tutorialCompleted:
      resetProgressionLocks
        ? DEFAULT_PROGRESS.tutorialCompleted
        : typeof raw.tutorialCompleted === "boolean"
          ? raw.tutorialCompleted
          : true,
    currentLevelKey:
      resetProgressionLocks
        ? DEFAULT_PROGRESS.currentLevelKey
        : savedCurrentLevel &&
            savedCurrentGroup &&
            unlockedGroupIds.includes(savedCurrentGroup.id)
          ? levelKey(savedCurrentLevel)
          : levelKey(inferredCurrentLevel),
    adsRemoved: raw.adsRemoved === true,
    purchaseHistory,
    processedTransactionIds,
  };
}

export async function loadProgress() {
  try {
    const saved = await AsyncStorage.getItem(SAVE_KEY);
    return saved ? normalizeProgress(JSON.parse(saved)) : DEFAULT_PROGRESS;
  } catch {
    return DEFAULT_PROGRESS;
  }
}

export async function saveProgress(progress: PlayerProgress) {
  try {
    await AsyncStorage.setItem(SAVE_KEY, JSON.stringify(progress));
  } catch {
    // A temporary storage failure must never close the game.
  }
}

export async function clearProgress() {
  await AsyncStorage.removeItem(SAVE_KEY);
}

export function rewardsFor(difficulty: Difficulty, _stars: number) {
  const hintCoins =
    difficulty === "easy" ? 2 : difficulty === "medium" ? 3 : 4;
  const layerCoins =
    difficulty === "easy" ? 2 : difficulty === "medium" ? 3 : 4;
  return {
    hintCoins,
    layerCoins,
  };
}

export const HINT_PRICE = 10;
