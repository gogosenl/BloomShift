import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  FlatList,
  Image,
  ImageBackground,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import {
  type AudioPlayer,
  setAudioModeAsync,
  useAudioPlayer,
} from "expo-audio";
import { StatusBar } from "expo-status-bar";
import type {
  InterstitialAd as InterstitialAdInstance,
  RewardedAd as RewardedAdInstance,
} from "react-native-google-mobile-ads";
import type {
  Product as IapProduct,
  Purchase as IapPurchase,
} from "expo-iap";
import {
  BoardSize,
  DIFFICULTY_LABELS,
  Difficulty,
  Direction,
  LEVELS,
  Level,
  Move,
  PROGRESSION_GROUPS,
  ProgressionGroup,
  levelKey,
  isWarmupGroup,
  isWarmupLevel,
  numberInProgressionGroup,
  progressionGroupForLevel,
  rotateGroup,
  sameBoard,
  sameMove,
} from "./src/game";
import {
  DEFAULT_PROGRESS,
  HINT_PRICE,
  AppLanguage,
  PlayerProgress,
  loadProgress,
  rewardsFor,
  saveProgress,
} from "./src/progress";

const LanguageContext = createContext<AppLanguage>("en");

// Temporary promotional screenshot mode. This only changes what is available
// on screen; it does not overwrite or unlock anything in the player's save.
// Set this back to false before the next store build.
const PROMO_SCREENSHOT_MODE = false;

declare const require: (moduleName: string) => any;

const GoogleMobileAds = (() => {
  try {
    return require("react-native-google-mobile-ads") as typeof import("react-native-google-mobile-ads");
  } catch (error) {
    if (__DEV__) {
      console.warn("Google Mobile Ads native module is not available", error);
    }
    return null;
  }
})();

// Keep Expo Go usable for visual/gameplay checks. Store purchases are available
// in development and store builds where the native expo-iap module is present.
const ExpoIap = (() => {
  try {
    return require("expo-iap") as typeof import("expo-iap");
  } catch (error) {
    if (__DEV__) {
      console.warn("In-app purchase native module is not available", error);
    }
    return null;
  }
})();

const mobileAds = GoogleMobileAds?.default;
const AdEventType = GoogleMobileAds?.AdEventType;
const AdsConsent = GoogleMobileAds?.AdsConsent;
const InterstitialAd = GoogleMobileAds?.InterstitialAd;
const RewardedAd = GoogleMobileAds?.RewardedAd;
const RewardedAdEventType = GoogleMobileAds?.RewardedAdEventType;
const ADMOB_NATIVE_MODULE_AVAILABLE = Boolean(
  mobileAds &&
    AdEventType &&
    AdsConsent &&
    InterstitialAd &&
    RewardedAd &&
    RewardedAdEventType
);

// Expo/Metro development sessions are gameplay-only tests. Ads are enabled
// exclusively in installable store builds, so Expo never requests either a
// Google test ad or a live ad.
const ADS_RUNTIME_ENABLED =
  !__DEV__ && process.env.EXPO_PUBLIC_ADMOB_DISABLE_ADS !== "true";
const IOS_REWARDED_AD_UNIT_ID =
  process.env.EXPO_PUBLIC_ADMOB_IOS_REWARDED_AD_UNIT_ID ??
  "ca-app-pub-2671380652899301/8228386484";
const IOS_INTERSTITIAL_AD_UNIT_ID =
  process.env.EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_AD_UNIT_ID ??
  "ca-app-pub-2671380652899301/6062860328";
const REWARDED_ADS_ENABLED =
  ADS_RUNTIME_ENABLED &&
  ADMOB_NATIVE_MODULE_AVAILABLE &&
  (Platform.OS === "android" || Boolean(IOS_REWARDED_AD_UNIT_ID));
const INTERSTITIAL_ADS_ENABLED =
  ADS_RUNTIME_ENABLED &&
  ADMOB_NATIVE_MODULE_AVAILABLE &&
  (Platform.OS === "android" ||
    Boolean(IOS_INTERSTITIAL_AD_UNIT_ID));
const ADMOB_ENABLED = REWARDED_ADS_ENABLED || INTERSTITIAL_ADS_ENABLED;
const ADMOB_REWARDED_AD_UNIT_ID =
  Platform.OS === "ios"
    ? IOS_REWARDED_AD_UNIT_ID
    : "ca-app-pub-2671380652899301/1462941231";
const ADMOB_INTERSTITIAL_AD_UNIT_ID =
  Platform.OS === "ios"
    ? IOS_INTERSTITIAL_AD_UNIT_ID
    : "ca-app-pub-2671380652899301/5634266325";
const REMOVE_ADS_PRODUCT_ID = "remove_ads";
const STORE_PRODUCT_CATALOG = {
  hint_coins_60: { currency: "hint", amount: 60, fallbackPrice: "₺29.99" },
  hint_coins_200: { currency: "hint", amount: 200, fallbackPrice: "₺69.99" },
  hint_coins_500: { currency: "hint", amount: 500, fallbackPrice: "₺129.99" },
  layer_coins_100: { currency: "layer", amount: 100, fallbackPrice: "₺39.99" },
  layer_coins_350: { currency: "layer", amount: 350, fallbackPrice: "₺99.99" },
  layer_coins_900: { currency: "layer", amount: 900, fallbackPrice: "₺199.99" },
  [REMOVE_ADS_PRODUCT_ID]: {
    currency: "adFree",
    amount: 1,
    fallbackPrice: "₺149.99",
  },
} as const;
type StoreProductId = keyof typeof STORE_PRODUCT_CATALOG;
const STORE_PRODUCT_IDS = Object.keys(
  STORE_PRODUCT_CATALOG
) as StoreProductId[];

function translated(language: AppLanguage, turkish: string, english: string) {
  return language === "en" ? english : turkish;
}

const EN_DIFFICULTY_LABELS = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
} as const;

const PALETTE = [
  { main: "#3976D2", pale: "#B9D2F4", name: "mavi" },
  { main: "#F3BD36", pale: "#F6DEA0", name: "sarı" },
  { main: "#35A27D", pale: "#B5DFC9", name: "yeşil" },
  { main: "#E66F62", pale: "#F1BDB5", name: "mercan" },
  { main: "#8B6FD6", pale: "#D3C6EB", name: "mor" },
  { main: "#D865A1", pale: "#EFBAD2", name: "pembe" },
];

function paletteAt(index: number) {
  return PALETTE[index] ?? PALETTE[0];
}

const LAYER_THEMES: Record<
  BoardSize,
  {
    name: string;
    background: string;
    accent: string;
    image: number;
  }
> = {
  3: {
    name: "Sabah Bahçesi",
    background: "#F4F1E8",
    accent: "#3976D2",
    image: require("./assets/images/layer-morning-v1.jpg"),
  },
  4: {
    name: "Çayır Bahçesi",
    background: "#E8EFE5",
    accent: "#35A27D",
    image: require("./assets/images/layer-meadow-v1.jpg"),
  },
  5: {
    name: "Gün Batımı Bahçesi",
    background: "#F8E8DD",
    accent: "#E66F62",
    image: require("./assets/images/layer-sunset-v1.jpg"),
  },
  6: {
    name: "Gece Bahçesi",
    background: "#E9E7F3",
    accent: "#756A9B",
    image: require("./assets/images/layer-night-v1.jpg"),
  },
};

const LEVEL_MODE_THEMES: Record<
  Difficulty,
  {
    background: string;
    primary: string;
    accent: string;
    surface: string;
    border: string;
    selectedSurface: string;
    bottomBar: string;
    progress: string;
    unlocked: string;
    image: number;
    imageOpacity: number;
  }
> = {
  easy: {
    background: "#F7F1E4",
    primary: "#145342",
    accent: "#E76F61",
    surface: "rgba(255,253,247,0.96)",
    border: "#DED5C2",
    selectedSurface: "#FFF8E8",
    bottomBar: "#124A3C",
    progress: "#43A17B",
    unlocked: "#5E9675",
    image: require("./assets/images/layer-morning-v1.jpg"),
    imageOpacity: 0.24,
  },
  medium: {
    background: "#FBF0D9",
    primary: "#8A5A12",
    accent: "#D68A29",
    surface: "rgba(255,249,232,0.97)",
    border: "#E3C98E",
    selectedSurface: "#FFF0C8",
    bottomBar: "#76501A",
    progress: "#D59A28",
    unlocked: "#B27B27",
    image: require("./assets/images/layer-sunset-v1.jpg"),
    imageOpacity: 0.3,
  },
  hard: {
    background: "#EEEAF6",
    primary: "#554778",
    accent: "#D2687E",
    surface: "rgba(249,246,255,0.97)",
    border: "#CEC4DF",
    selectedSurface: "#F1E9FA",
    bottomBar: "#44385F",
    progress: "#8068B4",
    unlocked: "#77649D",
    image: require("./assets/images/layer-night-v1.jpg"),
    imageOpacity: 0.36,
  },
};

const UI_ICONS = {
  hintCurrency: require("./assets/icons/currency-hint.png"),
  layerCurrency: require("./assets/icons/currency-layer.png"),
  home: require("./assets/icons/nav-home.png"),
  reset: require("./assets/icons/action-reset.png"),
  hint: require("./assets/icons/action-hint.png"),
  settings: require("./assets/icons/action-settings.png"),
  removeAds: require("./assets/icons/action-remove-ads-v2.png"),
  rotateLeft: require("./assets/icons/action-rotate-left.png"),
  rotateRight: require("./assets/icons/action-rotate-right.png"),
};

const STAR_ASSETS = {
  full: require("./assets/art/rewards/star-full.png"),
  glow: require("./assets/art/rewards/star-glow.png"),
  empty: require("./assets/art/rewards/star-empty.png"),
};

const FLOWER_ASSETS = {
  blue: require("./assets/art/flowers/flower-blue.png"),
  yellow: require("./assets/art/flowers/flower-yellow.png"),
  green: require("./assets/art/flowers/flower-green.png"),
  coral: require("./assets/art/flowers/flower-coral-v2.png"),
  purple: require("./assets/art/flowers/flower-purple.png"),
  pink: require("./assets/art/flowers/flower-pink.png"),
};

const LEVEL_MEDALLION_ASSETS = {
  completed: require("./assets/art/levels/level-completed.png"),
  current: require("./assets/art/levels/level-current.png"),
  locked: require("./assets/art/levels/level-locked.png"),
};

const BOARD_ASSETS = {
  herbariumFrame: require("./assets/art/board/cell-herbarium-frame.png"),
};

function flowerAssetForColor(color: string) {
  const normalized = color.toUpperCase();
  if (normalized === "#3976D2" || normalized === "#326FD0") {
    return FLOWER_ASSETS.blue;
  }
  if (
    normalized === "#F3BD36" ||
    normalized === "#EFB72C" ||
    normalized === "#D59A28"
  ) {
    return FLOWER_ASSETS.yellow;
  }
  if (
    normalized === "#E66F62" ||
    normalized === "#DF6559" ||
    normalized === "#F06F5D"
  ) {
    return FLOWER_ASSETS.coral;
  }
  if (
    normalized === "#8B6FD6" ||
    normalized === "#8065CC" ||
    normalized === "#756A9B"
  ) {
    return FLOWER_ASSETS.purple;
  }
  if (normalized === "#D865A1" || normalized === "#CF5794") {
    return FLOWER_ASSETS.pink;
  }
  return FLOWER_ASSETS.green;
}

const UiIcon = React.memo(function UiIcon({
  source,
  size,
}: {
  source: number;
  size: number;
}) {
  return (
    <Image
      source={source}
      resizeMode="contain"
      fadeDuration={0}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.2,
        overflow: "hidden",
      }}
    />
  );
});

const AdFreeIcon = React.memo(function AdFreeIcon({
  size = 36,
  active = false,
}: {
  size?: number;
  active?: boolean;
}) {
  return (
    <Image
      source={UI_ICONS.removeAds}
      resizeMode="contain"
      fadeDuration={0}
      style={{
        width: size,
        height: size,
        opacity: active ? 1 : 0.98,
      }}
    />
  );
});

const AnimatedUiIcon = React.memo(function AnimatedUiIcon({
  source,
  size,
  pressed,
  selected = false,
}: {
  source: number;
  size: number;
  pressed: boolean;
  selected?: boolean;
}) {
  const pressProgress = useRef(new Animated.Value(0)).current;
  const selectedProgress = useRef(
    new Animated.Value(selected ? 1 : 0)
  ).current;

  useEffect(() => {
    const animation = Animated.spring(pressProgress, {
      toValue: pressed ? 1 : 0,
      speed: pressed ? 22 : 16,
      bounciness: pressed ? 0 : 4,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [pressProgress, pressed]);

  useEffect(() => {
    const animation = Animated.spring(selectedProgress, {
      toValue: selected ? 1 : 0,
      speed: 15,
      bounciness: 4,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [selected, selectedProgress]);

  const pressScale = pressProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.93],
  });
  const selectedScale = selectedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.035],
  });

  return (
    <Animated.View
      style={{
        opacity: pressProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 0.94],
        }),
        transform: [
          { scale: Animated.multiply(pressScale, selectedScale) },
          {
            translateY: selectedProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, -0.5],
            }),
          },
        ],
      }}
    >
      <UiIcon source={source} size={size} />
    </Animated.View>
  );
});

function starsForMoves(level: Level, moves: number) {
  return moves <= level.par
    ? 3
    : moves <= level.par + Math.max(2, Math.floor(level.par / 3))
      ? 2
      : 1;
}

function StarImage({
  earned,
  size,
}: {
  earned: boolean;
  size: number;
}) {
  return (
    <Image
      source={earned ? STAR_ASSETS.full : STAR_ASSETS.empty}
      resizeMode="contain"
      fadeDuration={0}
      style={{ width: size, height: size }}
    />
  );
}

const StarRewardDisplay = React.memo(function StarRewardDisplay({
  stars,
  compact = false,
  animated = false,
}: {
  stars: number;
  compact?: boolean;
  animated?: boolean;
}) {
  const starAnimations = useRef([
    new Animated.Value(animated ? 0 : 1),
    new Animated.Value(animated ? 0 : 1),
    new Animated.Value(animated ? 0 : 1),
  ]).current;
  const safeStars = Math.max(1, Math.min(3, Math.round(stars || 1)));
  const size = compact ? 40 : 52;

  useEffect(() => {
    if (!animated) {
      starAnimations.forEach((value) => value.setValue(1));
      return;
    }
    starAnimations.forEach((value) => value.setValue(0));
    const animation = Animated.stagger(
      330,
      starAnimations.map((value) =>
        Animated.sequence([
          Animated.delay(120),
          Animated.spring(value, {
          toValue: 1,
            speed: 4,
            bounciness: 9,
          useNativeDriver: false,
          }),
        ])
      )
    );
    animation.start();
    return () => animation.stop();
  }, [animated, safeStars, starAnimations]);

  return (
    <View style={[styles.starRewardRow, compact && styles.starRewardRowCompact]}>
      {[0, 1, 2].map((index) => {
        const earned = index < safeStars;
        const scale = starAnimations[index].interpolate({
          inputRange: [0, 1],
          outputRange: [0.35, 1],
        });
        const translateY = starAnimations[index].interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
        });
        return (
          <Animated.View
            key={`win-star-${index}`}
            style={{
              opacity: starAnimations[index],
              transform: [{ translateY }, { scale }],
            }}
          >
            <StarImage
              earned={earned}
              size={size}
            />
          </Animated.View>
        );
      })}
    </View>
  );
});

const CompactStarRow = React.memo(function CompactStarRow({
  stars,
}: {
  stars: number;
}) {
  const safeStars = Math.max(1, Math.min(3, Math.round(stars || 1)));
  return (
    <View style={styles.levelTileStars}>
      {[0, 1, 2].map((index) => (
        <StarImage
          key={`tile-star-${index}`}
          earned={index < safeStars}
          size={13}
        />
      ))}
    </View>
  );
});

const Flower = React.memo(function Flower({
  color,
  size,
}: {
  color: string;
  size: number;
}) {
  return (
    <Image
      source={flowerAssetForColor(color)}
      resizeMode="contain"
      fadeDuration={0}
      style={{ width: size, height: size }}
    />
  );
});

const TargetPreview = React.memo(function TargetPreview({
  level,
  bottomGap,
  compact = false,
}: {
  level: Level;
  bottomGap?: number;
  compact?: boolean;
}) {
  const language = useContext(LanguageContext);
  const previewSize = compact ? 40 : 58;
  const gap = 2;
  const cellSize = (previewSize - gap * (level.cols - 1)) / level.cols;
  const previewHeight = cellSize * level.rows + gap * (level.rows - 1);

  return (
    <View
      style={[
        styles.previewCard,
        compact && {
          paddingHorizontal: 11,
          paddingVertical: 6,
          borderRadius: 14,
        },
        bottomGap !== undefined && { marginBottom: bottomGap },
      ]}
    >
      <View style={styles.previewCopy}>
        <View style={styles.previewTitleRow}>
          <Text
            style={[
              styles.previewEyebrow,
              compact && { fontSize: 9 },
            ]}
          >
            {translated(language, "HEDEF BAHÇE", "TARGET GARDEN")}
          </Text>
          <View
            style={[
              styles.difficultyBadge,
              level.difficulty === "medium" && styles.difficultyMedium,
              level.difficulty === "hard" && styles.difficultyHard,
            ]}
          >
            <Text style={styles.difficultyBadgeText}>
              {language === "en"
                ? EN_DIFFICULTY_LABELS[level.difficulty]
                : DIFFICULTY_LABELS[level.difficulty]}
            </Text>
          </View>
        </View>
        <Text
          style={[styles.previewText, compact && { fontSize: 9 }]}
        >
          {translated(
            language,
            `${level.colorCount} renk • Çiçekleri renkli alanlarına yerleştir.`,
            `${level.colorCount} colors • Place every flower on its matching ground.`
          )}
        </Text>
      </View>
      <View
        style={[
          styles.previewGrid,
          { width: previewSize, height: previewHeight, gap },
        ]}
      >
        {level.target.map((colorIndex, index) => (
          <View
            key={index}
            style={[
              styles.previewCell,
              {
                width: cellSize,
                height: cellSize,
                backgroundColor: paletteAt(colorIndex).main,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
});

function indicesForMove(size: number, move: Move) {
  const topLeft = move.row * size + move.col;
  return [
    topLeft,
    topLeft + 1,
    topLeft + size,
    topLeft + size + 1,
  ];
}

function destinationForMove(index: number, size: number, move: Move) {
  const topLeft = move.row * size + move.col;
  const topRight = topLeft + 1;
  const bottomLeft = topLeft + size;
  const bottomRight = bottomLeft + 1;

  if (move.direction === 1) {
    if (index === topLeft) return topRight;
    if (index === topRight) return bottomRight;
    if (index === bottomRight) return bottomLeft;
    if (index === bottomLeft) return topLeft;
  } else {
    if (index === topLeft) return bottomLeft;
    if (index === bottomLeft) return bottomRight;
    if (index === bottomRight) return topRight;
    if (index === topRight) return topLeft;
  }

  return index;
}

function boardGeometry(
  windowWidth: number,
  windowHeight: number,
  level: Level
) {
  const veryCompactHeight = windowHeight < 680;
  const narrowWidth = windowWidth < 360;
  const gap =
    level.size === 3 ? 12 : level.size === 4 ? 9 : level.size === 5 ? 7 : 6;
  const responsiveGap = narrowWidth ? Math.max(4, gap - 2) : gap;
  const horizontalInset = narrowWidth ? 16 : 32;
  const widthLimit = Math.min(
    windowWidth - horizontalInset,
    windowWidth >= 700 ? 560 : 430
  );
  const verticalReserve =
    level.rows > level.cols
      ? veryCompactHeight
        ? 398
        : 390
      : veryCompactHeight
        ? 412
      : windowHeight < 720
        ? 340
        : 320;
  const heightLimit = Math.max(
    veryCompactHeight ? 154 : 180,
    Math.min(560, windowHeight - verticalReserve)
  );
  const cellFromWidth =
    (widthLimit - responsiveGap * (level.cols - 1)) / level.cols;
  const cellFromHeight =
    (heightLimit - responsiveGap * (level.rows - 1)) / level.rows;
  const minimumCellSize = windowHeight < 600 || narrowWidth ? 24 : 32;
  const cellSize = Math.max(
    minimumCellSize,
    Math.min(cellFromWidth, cellFromHeight)
  );
  const boardWidth =
    cellSize * level.cols + responsiveGap * (level.cols - 1);
  const boardHeight =
    cellSize * level.rows + responsiveGap * (level.rows - 1);

  return { boardWidth, boardHeight, cellSize, gap: responsiveGap };
}

function GameBoard({
  level,
  board,
  direction,
  onRippleCommitted,
  onRippleStarted,
  onAnimationStateChange,
  requestedMove,
}: {
  level: Level;
  board: number[];
  direction: Direction;
  onRippleCommitted: (
    row: number,
    col: number,
    direction: Direction,
    nextBoard: number[]
  ) => void;
  onRippleStarted: () => void;
  onAnimationStateChange: (animating: boolean) => void;
  requestedMove: (Move & { requestId: number }) | null;
}) {
  const language = useContext(LanguageContext);
  const { width, height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const rippleProgress = useRef(new Animated.Value(0)).current;
  const moveLock = useRef(false);
  const movementAnimationRef =
    useRef<Animated.CompositeAnimation | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const commitFrameRef = useRef<number | null>(null);
  const animationStartedRef = useRef(false);
  const moveGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const [pieceScene, setPieceScene] = useState(() => ({
    activeMove: null as Move | null,
    displayBoard: [...board],
    animationSourceBoard: null as number[] | null,
    animationTargetBoard: null as number[] | null,
    moveGeneration: 0,
  }));
  const {
    activeMove,
    displayBoard,
    animationSourceBoard,
    animationTargetBoard,
    moveGeneration,
  } = pieceScene;
  const { boardWidth, boardHeight, cellSize, gap } = boardGeometry(
    width,
    height,
    level
  );
  const responsiveBoardGap =
    height < 680
      ? 4
      : level.rows > level.cols
      ? 6
      : 12 +
        Math.min(
          17,
          Math.max(0, height - boardHeight - 620) * 0.08
        );
  const rippleSize =
    level.size === 3 ? 38 : level.size === 4 ? 34 : level.size === 5 ? 29 : 25;
  const flowerSize = Math.min(
    level.size <= 4 ? 74 : 54,
    cellSize * 0.72
  );
  const cellRadius = level.size <= 4 ? 22 : level.size === 5 ? 17 : 14;

  useEffect(() => {
    setPieceScene((previousScene) => {
      if (previousScene.activeMove) return previousScene;
      if (sameBoard(previousScene.displayBoard, board)) return previousScene;
      return {
        ...previousScene,
        displayBoard: [...board],
      };
    });
  }, [board, level.globalIndex]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      movementAnimationRef.current?.stop();
      movementAnimationRef.current = null;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (commitFrameRef.current !== null) {
        cancelAnimationFrame(commitFrameRef.current);
        commitFrameRef.current = null;
      }
      moveLock.current = false;
    };
  }, []);

  useEffect(() => {
    if (!requestedMove) return;
    beginRipple(
      requestedMove.row,
      requestedMove.col,
      requestedMove.direction
    );
  }, [requestedMove?.requestId]);

  useEffect(() => {
    if (
      !activeMove ||
      !animationSourceBoard ||
      !animationTargetBoard ||
      animationStartedRef.current
    ) {
      return;
    }

    animationStartedRef.current = true;
    progress.setValue(0);
    rippleProgress.setValue(0);
    onRippleStarted();
    onAnimationStateChange(true);

    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const movementAnimation = Animated.parallel([
        Animated.timing(progress, {
          toValue: 1,
          duration: 840,
          easing: Easing.bezier(0.45, 0, 0.55, 1),
          // Four pieces are inexpensive to animate on the JS driver. Keeping
          // their transforms on the native driver can race the final React
          // layout commit and briefly detach an image from its slot.
          useNativeDriver: false,
        }),
        Animated.timing(rippleProgress, {
          toValue: 1,
          duration: 780,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ]);
      movementAnimationRef.current = movementAnimation;
      movementAnimation.start(({ finished }) => {
        movementAnimationRef.current = null;
        if (!mountedRef.current) return;
        if (finished) {
          const completedMove = activeMove;
          const completedBoard = [...animationTargetBoard];

          // Keep the native animation's final frame visible while Android
          // finishes compositing larger boards. Committing layout in the same
          // frame can briefly drop image layers on 5x5 and 6x6 boards.
          commitFrameRef.current = requestAnimationFrame(() => {
            commitFrameRef.current = requestAnimationFrame(() => {
              commitFrameRef.current = null;
              if (!mountedRef.current) return;
              // Static flowers never move between native views. The already
              // mounted target flowers become visible in the same React commit
              // that removes the four temporary moving copies.
              setPieceScene((previousScene) => ({
                ...previousScene,
                activeMove: null,
                displayBoard: completedBoard,
                animationSourceBoard: null,
                animationTargetBoard: null,
              }));
              moveLock.current = false;
              animationStartedRef.current = false;
              onAnimationStateChange(false);
              onRippleCommitted(
                completedMove.row,
                completedMove.col,
                completedMove.direction,
                completedBoard
              );
            });
          });
          return;
        }
        progress.setValue(0);
        rippleProgress.setValue(0);
        setPieceScene((previous) => ({
          ...previous,
          activeMove: null,
          animationSourceBoard: null,
          animationTargetBoard: null,
        }));
        moveLock.current = false;
        animationStartedRef.current = false;
        onAnimationStateChange(false);
      });
    });

  }, [activeMove, animationSourceBoard, animationTargetBoard]);

  function beginRipple(
    row: number,
    col: number,
    moveDirection: Direction = direction
  ) {
    if (moveLock.current || activeMove) return;
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row < 0 ||
      col < 0 ||
      row >= level.rows - 1 ||
      col >= level.cols - 1 ||
      displayBoard.length !== level.rows * level.cols
    ) {
      return;
    }
    moveLock.current = true;
    animationStartedRef.current = false;
    // Reset before the moving pieces are rendered. Resetting after completion
    // can briefly put a piece back at its old position on a busy device.
    progress.stopAnimation();
    rippleProgress.stopAnimation();
    progress.setValue(0);
    rippleProgress.setValue(0);
    const move: Move = { row, col, direction: moveDirection };
    const sourceBoard = [...displayBoard];
    const nextDisplayBoard = rotateGroup(
      sourceBoard,
      level.cols,
      row,
      col,
      moveDirection
    );
    moveGenerationRef.current += 1;
    setPieceScene((previous) => ({
      ...previous,
      activeMove: move,
      animationSourceBoard: sourceBoard,
      animationTargetBoard: nextDisplayBoard,
      moveGeneration: moveGenerationRef.current,
    }));
  }

  const activeRippleCenter = activeMove
    ? {
        left:
          (activeMove.col + 1) * cellSize +
          activeMove.col * gap +
          gap / 2,
        top:
          (activeMove.row + 1) * cellSize +
          activeMove.row * gap +
          gap / 2,
      }
    : null;
  const movingIndices = activeMove
    ? indicesForMove(level.cols, activeMove)
    : [];
  const frameInset = Math.max(2, cellSize * 0.075);

  return (
    <View
      style={[
        styles.board,
        {
          width: boardWidth,
          height: boardHeight,
          gap,
          marginBottom: responsiveBoardGap,
        },
      ]}
    >
      {level.target.map((targetIndex, index) => {
        const row = Math.floor(index / level.cols);
        const col = index % level.cols;
        return (
          <View
            key={`target-${index}`}
            style={[
              styles.cell,
              {
                position: "absolute",
                width: cellSize,
                height: cellSize,
                left: col * (cellSize + gap),
                top: row * (cellSize + gap),
                borderRadius: cellRadius,
                backgroundColor: "transparent",
              },
            ]}
          >
          <View
            style={[
              styles.cellColorInset,
              {
                width: cellSize - frameInset * 2,
                height: cellSize - frameInset * 2,
                borderRadius: cellRadius * 0.78,
                top: frameInset,
                left: frameInset,
                backgroundColor: paletteAt(targetIndex).pale,
                borderColor: `${paletteAt(targetIndex).main}78`,
                borderWidth: 1.5,
              },
            ]}
          >
            <View style={styles.cellColorSoftLight} />
            <View
              style={[
                styles.cellColorDepth,
                {
                  backgroundColor: `${paletteAt(targetIndex).main}2C`,
                },
              ]}
            />
            <View style={styles.cellColorPaperWash} />
          </View>
          <Image
            source={BOARD_ASSETS.herbariumFrame}
            resizeMode="stretch"
            fadeDuration={0}
            style={styles.cellHerbariumFrame}
          />
          </View>
        );
      })}

      {(activeMove && animationTargetBoard
        ? animationTargetBoard
        : displayBoard
      ).map((color, position) => {
        const row = Math.floor(position / level.cols);
        const col = position % level.cols;
        const hiddenBehindMovingCopy = Boolean(
          activeMove && movingIndices.includes(position)
        );
        return (
          <View
            key={`flower-slot-${position}`}
            pointerEvents="none"
            collapsable={false}
            style={[
              styles.pieceSlot,
              {
                width: cellSize,
                height: cellSize,
                left: col * (cellSize + gap),
                top: row * (cellSize + gap),
                zIndex: 2,
                opacity: hiddenBehindMovingCopy ? 0 : 1,
              },
            ]}
          >
            <Flower
              key={`flower-${position}-${color}`}
              color={paletteAt(color).main}
              size={flowerSize}
            />
          </View>
        );
      })}

      {activeMove &&
        animationSourceBoard &&
        movingIndices.map((sourcePosition) => {
          const color = animationSourceBoard[sourcePosition];
          const row = Math.floor(sourcePosition / level.cols);
          const col = sourcePosition % level.cols;
          const destination = destinationForMove(
            sourcePosition,
            level.cols,
            activeMove
          );
          const destinationRow = Math.floor(destination / level.cols);
          const destinationCol = destination % level.cols;
          const translateX = progress.interpolate({
            inputRange: [0, 1],
            outputRange: [
              0,
              (destinationCol - col) * (cellSize + gap),
            ],
          });
          const translateY = progress.interpolate({
            inputRange: [0, 1],
            outputRange: [
              0,
              (destinationRow - row) * (cellSize + gap),
            ],
          });
          return (
            <Animated.View
              key={`moving-${moveGeneration}-${sourcePosition}`}
              pointerEvents="none"
              renderToHardwareTextureAndroid
              collapsable={false}
              style={[
                styles.pieceSlot,
                {
                  width: cellSize,
                  height: cellSize,
                  left: col * (cellSize + gap),
                  top: row * (cellSize + gap),
                  zIndex: 7,
                  transform: [{ translateX }, { translateY }],
                },
              ]}
            >
              <Flower
                color={paletteAt(color).main}
                size={flowerSize}
              />
            </Animated.View>
          );
        })}

      {activeRippleCenter &&
        [0, 1].map((ring) => {
          const start = ring * 0.16;
          const middle = start + 0.28;
          const end = Math.min(1, start + 0.7);
          const opacity = rippleProgress.interpolate({
            inputRange: [start, middle, end],
            outputRange: [0, 0.44 - ring * 0.08, 0],
            extrapolate: "clamp",
          });
          const ringScale = rippleProgress.interpolate({
            inputRange: [start, end],
            outputRange: [0.45, 2.5 + ring * 0.42],
            extrapolate: "clamp",
          });

          return (
            <Animated.View
              key={`wave-ring-${ring}`}
              pointerEvents="none"
              style={[
                styles.waveRing,
                {
                  width: rippleSize,
                  height: rippleSize,
                  borderRadius: rippleSize / 2,
                  left: activeRippleCenter.left - rippleSize / 2,
                  top: activeRippleCenter.top - rippleSize / 2,
                  opacity,
                  transform: [{ scale: ringScale }],
                },
              ]}
            />
          );
        })}

      {Array.from({ length: (level.rows - 1) * (level.cols - 1) }).map(
        (_, index) => {
          const row = Math.floor(index / (level.cols - 1));
          const col = index % (level.cols - 1);
          const key = `${row}-${col}`;
          const left = (col + 1) * cellSize + col * gap + gap / 2;
          const top = (row + 1) * cellSize + row * gap + gap / 2;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={
                direction === -1
                  ? translated(
                      language,
                      "Bu dört çiçeği sola döndür",
                      "Rotate these four flowers left"
                    )
                  : translated(
                      language,
                      "Bu dört çiçeği sağa döndür",
                      "Rotate these four flowers right"
                    )
              }
              disabled={Boolean(activeMove)}
              onPressIn={() => beginRipple(row, col)}
              hitSlop={level.size >= 5 ? 4 : 7}
              style={({ pressed }) => [
                styles.rippleButton,
                {
                  width: rippleSize,
                  height: rippleSize,
                  borderRadius: rippleSize / 2,
                  left: left - rippleSize / 2,
                  top: top - rippleSize / 2,
                  borderWidth: 0.75,
                },
              ]}
            >
              {({ pressed }) => (
                <AnimatedUiIcon
                  source={
                    direction === -1
                      ? UI_ICONS.rotateLeft
                      : UI_ICONS.rotateRight
                  }
                  size={rippleSize * 0.76}
                  pressed={pressed}
                />
              )}
            </Pressable>
          );
        }
      )}
    </View>
  );
}

type OpeningLogoTarget = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function OpeningScene({
  onRevealHome,
  onFinished,
  landingTarget,
}: {
  onRevealHome: () => void;
  onFinished: () => void;
  landingTarget: OpeningLogoTarget | null;
}) {
  const language = useContext(LanguageContext);
  const logoEntrance = useRef(new Animated.Value(0)).current;
  const waveProgress = useRef(new Animated.Value(0)).current;
  const copyEntrance = useRef(new Animated.Value(0)).current;
  const sceneOpacity = useRef(new Animated.Value(1)).current;
  const landingX = useRef(new Animated.Value(0)).current;
  const landingY = useRef(new Animated.Value(0)).current;
  const landingScale = useRef(new Animated.Value(1)).current;
  const logoStageRef = useRef<View>(null);
  const logoStageLayoutRef = useRef<OpeningLogoTarget | null>(null);
  const landingTargetRef = useRef(landingTarget);
  const finishRef = useRef(onFinished);
  const revealRef = useRef(onRevealHome);
  const { height } = useWindowDimensions();

  landingTargetRef.current = landingTarget;
  finishRef.current = onFinished;
  revealRef.current = onRevealHome;

  function measureLogoStage() {
    requestAnimationFrame(() => {
      logoStageRef.current?.measureInWindow((x, y, width, measuredHeight) => {
        logoStageLayoutRef.current = {
          x,
          y,
          width,
          height: measuredHeight,
        };
      });
    });
  }

  useEffect(() => {
    let active = true;
    let landingTimer: ReturnType<typeof setTimeout> | null = null;
    let landingAnimation: Animated.CompositeAnimation | null = null;

    function startLanding(attempt = 0) {
      if (!active) return;
      const source = logoStageLayoutRef.current;
      const target = landingTargetRef.current;

      if ((!source || !target) && attempt < 30) {
        landingTimer = setTimeout(() => startLanding(attempt + 1), 24);
        return;
      }

      const fallbackY = -Math.min(
        285,
        Math.max(210, height * 0.32)
      );
      const destinationX =
        source && target
          ? target.x +
            target.width / 2 -
            (source.x + source.width / 2)
          : 0;
      const destinationY =
        source && target
          ? target.y +
            target.height / 2 -
            (source.y + source.height / 2)
          : fallbackY;
      const destinationScale =
        target?.width && source?.width
          ? target.width / 126
          : 104 / 126;

      landingAnimation = Animated.parallel([
        Animated.timing(sceneOpacity, {
          toValue: 0,
          duration: 1450,
          easing: Easing.bezier(0.42, 0, 0.2, 1),
          useNativeDriver: false,
        }),
        Animated.timing(landingX, {
          toValue: destinationX,
          duration: 1450,
          easing: Easing.bezier(0.42, 0, 0.2, 1),
          useNativeDriver: false,
        }),
        Animated.timing(landingY, {
          toValue: destinationY,
          duration: 1450,
          easing: Easing.bezier(0.42, 0, 0.2, 1),
          useNativeDriver: false,
        }),
        Animated.timing(landingScale, {
          toValue: destinationScale,
          duration: 1450,
          easing: Easing.bezier(0.42, 0, 0.2, 1),
          useNativeDriver: false,
        }),
      ]);
      landingAnimation.start(() => {
        // iOS can report an interrupted native animation while the app is
        // becoming active. The visual overlay must never remain mounted and
        // silently capture every touch on the home screen.
        if (active) finishRef.current();
      });
    }

    const openingAnimation = Animated.parallel([
      Animated.spring(logoEntrance, {
        toValue: 1,
        speed: 7,
        bounciness: 13,
        useNativeDriver: false,
      }),
      Animated.timing(waveProgress, {
        toValue: 1,
        duration: 1550,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.delay(380),
        Animated.timing(copyEntrance, {
          toValue: 1,
          duration: 650,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ]),
    ]);

    openingAnimation.start(({ finished }) => {
      if (!finished) return;
      if (Platform.OS === "android") {
        landingTimer = setTimeout(() => finishRef.current(), 260);
        return;
      }
      revealRef.current();
      landingTimer = setTimeout(() => startLanding(), 120);
    });
    return () => {
      active = false;
      openingAnimation.stop();
      landingAnimation?.stop();
      if (landingTimer) clearTimeout(landingTimer);
    };
  }, [
    copyEntrance,
    height,
    landingScale,
    landingX,
    landingY,
    logoEntrance,
    sceneOpacity,
    waveProgress,
  ]);

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.openingScene}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          styles.openingVeil,
          { opacity: sceneOpacity },
        ]}
      />
      <Animated.Text
        style={[
          styles.openingBotanical,
          styles.openingBotanicalLeft,
          { opacity: sceneOpacity },
        ]}
      >
        ❧
      </Animated.Text>
      <Animated.Text
        style={[
          styles.openingBotanical,
          styles.openingBotanicalRight,
          { opacity: sceneOpacity },
        ]}
      >
        ❧
      </Animated.Text>
      <Animated.View
        ref={logoStageRef}
        onLayout={measureLogoStage}
        style={[
          styles.openingLogoStage,
          {
            transform: [
              { translateX: landingX },
              { translateY: landingY },
              { scale: landingScale },
            ],
          },
        ]}
      >
        {[0, 1, 2].map((ring) => {
          const start = ring * 0.16;
          const end = Math.min(1, start + 0.62);
          return (
            <Animated.View
              key={`opening-ring-${ring}`}
              style={[
                styles.openingRing,
                {
                  opacity: waveProgress.interpolate({
                    inputRange: [start, Math.min(1, start + 0.18), end],
                    outputRange: [0, 0.34 - ring * 0.07, 0],
                    extrapolate: "clamp",
                  }),
                  transform: [
                    {
                      scale: waveProgress.interpolate({
                        inputRange: [start, end],
                        outputRange: [0.58, 2.45 + ring * 0.32],
                        extrapolate: "clamp",
                      }),
                    },
                  ],
                },
              ]}
            />
          );
        })}
        <Animated.View
          style={[
            styles.openingLogoWrap,
            {
              opacity: logoEntrance,
              transform: [
                {
                  scale: logoEntrance.interpolate({
                    inputRange: [0, 0.72, 1],
                    outputRange: [0.42, 1.08, 1],
                  }),
                },
                {
                  rotate: logoEntrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["-18deg", "0deg"],
                  }),
                },
              ],
            },
          ]}
        >
          <Image
            source={require("./assets/images/app-icon-bloomshift-v2.png")}
            style={styles.openingLogo}
          />
        </Animated.View>
      </Animated.View>
      <Animated.View
        style={[
          styles.openingCopy,
          {
            opacity: copyEntrance,
            transform: [
              {
                translateY: copyEntrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [18, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Animated.View style={{ opacity: sceneOpacity }}>
          <Text style={styles.openingTitle}>Bloomshift</Text>
          <Text style={styles.openingSubtitle}>
            {translated(
              language,
              "Renklerle Uyanan Sakinlik",
              "Calm Awakened by Color"
            )}
          </Text>
          <View style={styles.openingDivider}>
            <View style={styles.openingDividerLine} />
            <Flower color="#35A27D" size={20} />
            <View style={styles.openingDividerLine} />
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

type TutorialStage = "ground" | "flowers" | "practice" | "complete";

function FirstLevelTutorial({ onComplete }: { onComplete: () => void }) {
  const language = useContext(LanguageContext);
  const { width, height } = useWindowDimensions();
  const [stage, setStage] = useState<TutorialStage>("ground");
  const [moving, setMoving] = useState(false);
  const [solved, setSolved] = useState(false);
  const entrance = useRef(new Animated.Value(0)).current;
  const groundOpacity = useRef(new Animated.Value(0)).current;
  const flowerOpacity = useRef(new Animated.Value(0)).current;
  const movement = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const success = useRef(new Animated.Value(0)).current;
  const sceneOpacity = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const columns = 2;
  const gap = 8;
  const tutorialCellLimit = height < 700 ? 64 : 80;
  const cellSize = Math.min(
    tutorialCellLimit,
    Math.max(52, (width - 88 - gap) / 2)
  );
  const boardWidth = cellSize * columns + gap * (columns - 1);
  const boardHeight = cellSize * 3 + gap * 2;
  const rippleSize = 42;
  const targetColors = [0, 1, 0, 1, 0, 1];
  const initialColors = [1, 1, 0, 0, 0, 1];
  const movingDestinations: Record<number, number> = {
    0: 1,
    1: 3,
    3: 2,
    2: 0,
  };

  useEffect(() => {
    Animated.parallel([
      Animated.spring(entrance, {
        toValue: 1,
        speed: 8,
        bounciness: 12,
        useNativeDriver: false,
      }),
      Animated.timing(groundOpacity, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
    return () => pulseLoop.current?.stop();
  }, [entrance, groundOpacity]);

  function revealFlowers() {
    setStage("flowers");
    Animated.timing(flowerOpacity, {
      toValue: 1,
      duration: 650,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }

  function beginPractice() {
    setStage("practice");
    pulse.setValue(0);
    pulseLoop.current?.stop();
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 500,
          useNativeDriver: false,
        }),
      ])
    );
    pulseLoop.current.start();
  }

  function rotateTutorialFlowers() {
    if (stage !== "practice" || moving) return;
    setMoving(true);
    pulseLoop.current?.stop();
    movement.setValue(0);
    success.setValue(0);
    Animated.sequence([
      Animated.timing(movement, {
        toValue: 1,
        duration: 820,
        easing: Easing.bezier(0.45, 0, 0.55, 1),
        useNativeDriver: false,
      }),
      Animated.spring(success, {
        toValue: 1,
        speed: 9,
        bounciness: 15,
        useNativeDriver: false,
      }),
    ]).start(({ finished }) => {
      if (!finished) return;
      setSolved(true);
      setMoving(false);
      setStage("complete");
    });
  }

  function finishTutorial() {
    Animated.parallel([
      Animated.timing(sceneOpacity, {
        toValue: 0,
        duration: 520,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(entrance, {
        toValue: 0.94,
        duration: 520,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start(({ finished }) => {
      if (finished) onComplete();
    });
  }

  const stageNumber = stage === "ground" ? 1 : stage === "flowers" ? 2 : 3;
  const title =
    stage === "ground"
      ? translated(language, "Renkli Alanlar Hedefindir", "Colored Ground Is Your Target")
      : stage === "flowers"
        ? translated(language, "Her Çiçek Kendi Rengine Gider", "Every Flower Has a Matching Color")
        : stage === "practice"
          ? translated(language, "Şimdi Parlayan Dalgaya Dokun", "Now Tap the Glowing Wave")
          : translated(language, "Bahçe Hazır!", "The Garden Is Ready!");
  const description =
    stage === "ground"
      ? translated(
          language,
          "Her renkli bölme bir hedeftir. Önce mavi ve sarı hedeflerin yerlerini incele.",
          "Every colored cell is a target. First, notice where the blue and yellow targets are."
        )
      : stage === "flowers"
        ? translated(
          language,
          "Çiçek ve altında kalan alan aynı renkteyse doğrudur. Farklı renkteyse çiçeği taşımalısın.",
          "A flower is correct when it matches the ground beneath it. Move every flower that does not match."
          )
        : stage === "practice"
          ? translated(
              language,
              "Ortadaki dalga düğmesi yalnızca çevresindeki dört çiçeği bir adım kaydırır. Gerçek bölümde Sola veya Sağa yönünü seçebilirsin. Şimdi düğmeye sen bas.",
              "The center wave moves only its four surrounding flowers by one step. In a real level, choose Left or Right first. Now tap the button yourself."
            )
          : translated(
          language,
          "Tüm çiçekler hedef rengiyle eşleşti. Aynı işlemi gerçek bölümde yaparak bahçeyi tamamla.",
          "Every flower now matches its target color. Do the same in the real level to complete the garden."
        );

  const ruleText =
    stage === "ground"
      ? translated(
          language,
          "RENKLİ ZEMİN = ÇİÇEĞİN HEDEFİ",
          "COLORED GROUND = FLOWER TARGET"
        )
      : stage === "flowers"
        ? translated(
            language,
            "✓ AYNI RENK DOĞRU  •  ↻ FARKLI RENK TAŞINMALI",
            "✓ SAME COLOR IS CORRECT  •  ↻ MOVE MISMATCHES"
          )
        : stage === "practice"
          ? translated(
              language,
              "BİR DOKUNUŞ = DÖRT ÇİÇEK BİR ADIM KAYAR",
              "ONE TAP = FOUR FLOWERS MOVE ONE STEP"
            )
          : translated(
              language,
              "BÜTÜN RENKLER EŞLEŞİNCE BÖLÜM BİTER",
              "THE LEVEL ENDS WHEN EVERY COLOR MATCHES"
            );

  return (
    <Animated.View style={[styles.tutorialScene, { opacity: sceneOpacity }]}>
      <ImageBackground
        source={LAYER_THEMES[3].image}
        resizeMode="cover"
        style={styles.tutorialBackground}
        imageStyle={styles.tutorialBackgroundImage}
      >
        <View style={styles.tutorialVeil} />
        <SafeAreaView
          edges={["top", "bottom", "left", "right"]}
          style={styles.tutorialSafe}
        >
          <ScrollView
            contentContainerStyle={styles.tutorialPage}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Animated.View
              style={[
                styles.tutorialCard,
                {
                  transform: [
                    {
                      translateY: entrance.interpolate({
                        inputRange: [0, 1],
                        outputRange: [34, 0],
                      }),
                    },
                    { scale: entrance },
                  ],
                },
              ]}
            >
              <View style={styles.tutorialHeader}>
                <View style={styles.tutorialMiniLogo}>
                  <Flower color="#35A27D" size={38} />
                </View>
                <View style={styles.tutorialHeaderCopy}>
                  <Text style={styles.tutorialOverline}>
                    {translated(language, "NASIL OYNANIR?", "HOW TO PLAY?")}
                  </Text>
                  <Text style={styles.tutorialStepLabel}>
                    {stageNumber}/3
                  </Text>
                </View>
              </View>

              <Text style={styles.tutorialTitle}>{title}</Text>
              <Text style={styles.tutorialText}>{description}</Text>

              <View style={styles.tutorialRuleCard}>
                <View style={styles.tutorialRuleVisual}>
                  {stage === "ground" ? (
                    <>
                      <View
                        style={[
                          styles.tutorialRuleSwatch,
                          { backgroundColor: PALETTE[0].pale },
                        ]}
                      />
                      <View
                        style={[
                          styles.tutorialRuleSwatch,
                          { backgroundColor: PALETTE[1].pale },
                        ]}
                      />
                    </>
                  ) : stage === "flowers" ? (
                    <>
                      <Flower color={PALETTE[0].main} size={25} />
                      <Text style={styles.tutorialRuleEquals}>=</Text>
                      <View
                        style={[
                          styles.tutorialRuleSwatch,
                          { backgroundColor: PALETTE[0].pale },
                        ]}
                      />
                    </>
                  ) : stage === "practice" ? (
                    <UiIcon source={UI_ICONS.rotateRight} size={28} />
                  ) : (
                    <Text style={styles.tutorialRuleCheck}>✓</Text>
                  )}
                </View>
                <Text style={styles.tutorialRuleText}>{ruleText}</Text>
              </View>

              <Animated.View
                style={[
                  styles.tutorialBoard,
                  {
                    width: boardWidth,
                    height: boardHeight,
                    opacity: groundOpacity,
                    transform: [
                      {
                        scale: success.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, 1.035],
                        }),
                      },
                    ],
                  },
                ]}
              >
                {targetColors.map((colorIndex, index) => {
                  const row = Math.floor(index / columns);
                  const col = index % columns;
                  return (
                    <View
                      key={`tutorial-target-${index}`}
                      style={[
                        styles.tutorialCell,
                        {
                          width: cellSize,
                          height: cellSize,
                          left: col * (cellSize + gap),
                          top: row * (cellSize + gap),
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.tutorialCellColor,
                          {
                            backgroundColor: paletteAt(colorIndex).pale,
                            borderColor: `${paletteAt(colorIndex).main}8A`,
                          },
                        ]}
                      >
                        <View style={styles.cellColorSoftLight} />
                        <View
                          style={[
                            styles.cellColorDepth,
                            { backgroundColor: `${paletteAt(colorIndex).main}2C` },
                          ]}
                        />
                      </View>
                      <Image
                        source={BOARD_ASSETS.herbariumFrame}
                        resizeMode="stretch"
                        fadeDuration={0}
                        style={styles.cellHerbariumFrame}
                      />
                    </View>
                  );
                })}

                {stage !== "ground" &&
                  (solved ? targetColors : initialColors).map((colorIndex, index) => {
                    const row = Math.floor(index / columns);
                    const col = index % columns;
                    const destination = movingDestinations[index] ?? index;
                    const destinationRow = Math.floor(destination / columns);
                    const destinationCol = destination % columns;
                    const isAnimated = moving && movingDestinations[index] !== undefined;
                    return (
                      <Animated.View
                        key={`tutorial-flower-${solved ? "solved" : "start"}-${index}`}
                        pointerEvents="none"
                        style={[
                          styles.tutorialPiece,
                          {
                            width: cellSize,
                            height: cellSize,
                            left: col * (cellSize + gap),
                            top: row * (cellSize + gap),
                            opacity: flowerOpacity,
                            zIndex: isAnimated ? 6 : 3,
                            transform: isAnimated
                              ? [
                                  {
                                    translateX: movement.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: [
                                        0,
                                        (destinationCol - col) * (cellSize + gap),
                                      ],
                                    }),
                                  },
                                  {
                                    translateY: movement.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: [
                                        0,
                                        (destinationRow - row) * (cellSize + gap),
                                      ],
                                    }),
                                  },
                                ]
                              : [],
                          },
                        ]}
                      >
                        <Flower
                          color={paletteAt(colorIndex).main}
                          size={cellSize * 0.67}
                        />
                        {stage === "flowers" && (
                          <View
                            style={[
                              styles.tutorialMatchBadge,
                              colorIndex === targetColors[index]
                                ? styles.tutorialMatchBadgeCorrect
                                : styles.tutorialMatchBadgeMove,
                            ]}
                          >
                            <Text style={styles.tutorialMatchBadgeText}>
                              {colorIndex === targetColors[index] ? "✓" : "↻"}
                            </Text>
                          </View>
                        )}
                      </Animated.View>
                    );
                  })}

                {stage === "practice" && (
                  <>
                    {[0, 1].map((ring) => (
                      <Animated.View
                        key={`tutorial-ring-${ring}`}
                        pointerEvents="none"
                        style={[
                          styles.tutorialWaveRing,
                          {
                            width: rippleSize,
                            height: rippleSize,
                            borderRadius: rippleSize / 2,
                            left: cellSize + gap / 2 - rippleSize / 2,
                            top: cellSize + gap / 2 - rippleSize / 2,
                            opacity: pulse.interpolate({
                              inputRange: [0, 0.3, 1],
                              outputRange: [0, 0.55 - ring * 0.12, 0],
                            }),
                            transform: [
                              {
                                scale: pulse.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [0.72, 2.3 + ring * 0.4],
                                }),
                              },
                            ],
                          },
                        ]}
                      />
                    ))}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={translated(
                        language,
                        "Dört çiçeği sağa döndür",
                        "Rotate four flowers clockwise"
                      )}
                      disabled={moving}
                      onPress={rotateTutorialFlowers}
                      style={({ pressed }) => [
                        styles.tutorialRippleButton,
                        {
                          width: rippleSize,
                          height: rippleSize,
                          borderRadius: rippleSize / 2,
                          left: cellSize + gap / 2 - rippleSize / 2,
                          top: cellSize + gap / 2 - rippleSize / 2,
                        },
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <UiIcon source={UI_ICONS.rotateRight} size={32} />
                    </Pressable>
                  </>
                )}
              </Animated.View>

              <View style={styles.tutorialDots}>
                {[1, 2, 3].map((dot) => (
                  <View
                    key={dot}
                    style={[
                      styles.tutorialDot,
                      dot <= stageNumber && styles.tutorialDotActive,
                    ]}
                  />
                ))}
              </View>

              {stage === "practice" ? (
                <View style={styles.tutorialWaitingPill}>
                  <UiIcon source={UI_ICONS.rotateRight} size={25} />
                  <Text style={styles.tutorialWaitingText}>
                    {translated(language, "PARLAYAN DÜĞMEYE DOKUN", "TAP THE GLOWING BUTTON")}
                  </Text>
                </View>
              ) : (
                <Pressable
                  onPress={
                    stage === "ground"
                      ? revealFlowers
                      : stage === "flowers"
                        ? beginPractice
                        : finishTutorial
                  }
                  style={({ pressed }) => [
                    styles.tutorialPrimaryButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>
                    {stage === "ground"
                      ? translated(language, "Çiçekleri Göster", "Show the Flowers")
                      : stage === "flowers"
                        ? translated(language, "Şimdi Ben Deneyeyim", "Let Me Try")
                        : translated(language, "Oyuna Başla", "Start Playing")}
                  </Text>
                  <Text style={styles.primaryButtonArrow}>→</Text>
                </Pressable>
              )}
            </Animated.View>
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>
    </Animated.View>
  );
}

const LevelGridTile = React.memo(function LevelGridTile({
  item,
  current,
  completed,
  locked,
  newlyUnlocked,
  justCompleted,
  stars,
  accent,
  onPress,
}: {
  item: Level;
  current: boolean;
  completed: boolean;
  locked: boolean;
  newlyUnlocked: boolean;
  justCompleted: boolean;
  stars: number;
  accent: string;
  onPress: () => void;
}) {
  const language = useContext(LanguageContext);
  const unlockScale = useRef(new Animated.Value(1)).current;
  const unlockBurst = useRef(new Animated.Value(0)).current;
  const completionScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!newlyUnlocked) return;
    unlockScale.setValue(0.62);
    unlockBurst.setValue(0);
    const unlockAnimation = Animated.parallel([
      Animated.sequence([
        Animated.delay(620),
        Animated.spring(unlockScale, {
          toValue: 1.14,
          speed: 9,
          bounciness: 16,
          useNativeDriver: false,
        }),
        Animated.spring(unlockScale, {
          toValue: 1,
          speed: 10,
          bounciness: 7,
          useNativeDriver: false,
        }),
      ]),
      Animated.timing(unlockBurst, {
        toValue: 1,
        duration: 1450,
        delay: 620,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]);
    unlockAnimation.start();
    return () => unlockAnimation.stop();
  }, [newlyUnlocked, unlockBurst, unlockScale]);

  useEffect(() => {
    if (!justCompleted) return;
    completionScale.setValue(0.88);
    const animation = Animated.sequence([
      Animated.spring(completionScale, {
        toValue: 1.12,
        speed: 13,
        bounciness: 15,
        useNativeDriver: false,
      }),
      Animated.spring(completionScale, {
        toValue: 1,
        speed: 12,
        bounciness: 7,
        useNativeDriver: false,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [completionScale, justCompleted]);

  const medallionSource = locked
    ? LEVEL_MEDALLION_ASSETS.locked
    : completed
      ? LEVEL_MEDALLION_ASSETS.completed
      : LEVEL_MEDALLION_ASSETS.current;
  const localNumber = numberInProgressionGroup(item);

  return (
    <Animated.View
      style={[
        styles.levelTile,
        {
          transform: [
            { scale: Animated.multiply(unlockScale, completionScale) },
          ],
          opacity: locked ? 0.78 : 1,
        },
      ]}
    >
      <Pressable
        disabled={locked}
        onPress={onPress}
        style={({ pressed }) => [
          styles.levelFlowerPressable,
          pressed && styles.buttonPressed,
        ]}
      >
        {newlyUnlocked && (
          <Animated.View
            style={[
              styles.levelUnlockHalo,
              {
                opacity: unlockBurst.interpolate({
                  inputRange: [0, 0.18, 1],
                  outputRange: [0, 0.9, 0],
                }),
                transform: [
                  {
                    scale: unlockBurst.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.62, 1.7],
                    }),
                  },
                ],
              },
            ]}
          />
        )}
        <View
          style={[
            styles.levelFlowerVine,
            locked && styles.levelFlowerVineLocked,
          ]}
        />
        <Image
          source={medallionSource}
          resizeMode="contain"
          fadeDuration={0}
          style={styles.levelMedallionImage}
        />
        <View
          style={[
            styles.levelMedallionContent,
            current && styles.levelTileCurrent,
            completed && styles.levelTileComplete,
            newlyUnlocked && styles.levelTileNew,
          ]}
        >
          {locked ? (
            <>
              <Text style={styles.levelTileNumber}>{localNumber}</Text>
              <Text style={styles.levelTileLock}>▣</Text>
            </>
          ) : (
            <>
              <Text
                style={[
                  styles.levelTileNumber,
                  current && { color: accent },
                ]}
              >
                {localNumber}
              </Text>
              {completed && (
                <>
                  <Text style={styles.levelTileCheck}>✓</Text>
                  <CompactStarRow stars={stars} />
                </>
              )}
            </>
          )}
        </View>
        <Text
          style={[
            styles.levelTileMeta,
            completed && styles.levelTileMetaComplete,
            current && styles.levelTileMetaCurrent,
          ]}
        >
          {locked
            ? translated(language, "KİLİTLİ", "LOCKED")
            : completed
              ? translated(language, "✓ GEÇİLDİ", "✓ DONE")
              : current
                ? translated(language, "YENİ", "NEW")
                : ""}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

function VictoryBouquet() {
  const grow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    grow.setValue(0);
    Animated.spring(grow, {
      toValue: 1,
      speed: 8,
      bounciness: 13,
      useNativeDriver: false,
    }).start();
  }, [grow]);

  return (
    <Animated.View
      style={[
        styles.premiumBouquet,
        {
          opacity: grow,
          transform: [
            {
              translateY: grow.interpolate({
                inputRange: [0, 1],
                outputRange: [35, 0],
              }),
            },
            {
              scale: grow.interpolate({
                inputRange: [0, 1],
                outputRange: [0.45, 1],
              }),
            },
          ],
        },
      ]}
    >
      <Image
        source={require("./assets/art/rewards/reward-bouquet.png")}
        resizeMode="contain"
        fadeDuration={0}
        style={styles.premiumBouquetImage}
      />
    </Animated.View>
  );
}

function AnimatedRewardAmount({
  amount,
  currentBalance,
  iconSource,
  label,
  color,
}: {
  amount: number;
  currentBalance: number;
  iconSource: number;
  label: string;
  color: string;
}) {
  const value = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.72)).current;
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    value.setValue(0);
    scale.setValue(0.72);
    const listener = value.addListener(({ value: nextValue }) => {
      setDisplayValue(Math.round(nextValue));
    });
    Animated.parallel([
      Animated.timing(value, {
        toValue: amount,
        duration: 950,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.spring(scale, {
        toValue: 1,
        speed: 8,
        bounciness: 14,
        useNativeDriver: false,
      }),
    ]).start();
    return () => value.removeListener(listener);
  }, [amount, scale, value]);

  return (
    <Animated.View
      style={[
        styles.animatedRewardCard,
        { borderColor: color, transform: [{ scale }] },
      ]}
    >
      <View style={styles.animatedRewardSymbol}>
        <UiIcon source={iconSource} size={27} />
      </View>
      <Text style={styles.animatedRewardBalanceMath}>
        {currentBalance} + {displayValue}
      </Text>
      <Text style={styles.animatedRewardValue}>
        = {currentBalance + displayValue}
      </Text>
      <Text style={styles.animatedRewardLabel}>{label}</Text>
    </Animated.View>
  );
}

function LayerEntryScene({
  group,
  level,
  onFinished,
}: {
  group: ProgressionGroup;
  level?: Level;
  onFinished: () => void;
}) {
  const language = useContext(LanguageContext);
  const entrance = useRef(new Animated.Value(0)).current;
  const exitOpacity = useRef(new Animated.Value(1)).current;
  const finishedRef = useRef(false);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    entrance.setValue(0);
    exitOpacity.setValue(1);
    finishedRef.current = false;
    const isQuickLevelTransition = Boolean(level);
    const entranceAnimation = isQuickLevelTransition
      ? Animated.timing(entrance, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        })
      : Animated.parallel([
          Animated.spring(entrance, {
            toValue: 1,
            speed: 7,
            bounciness: 15,
            useNativeDriver: false,
          }),
          Animated.timing(exitOpacity, {
            toValue: 1,
            duration: 700,
            useNativeDriver: false,
          }),
        ]);
    const animation = isQuickLevelTransition
      ? Animated.sequence([
          entranceAnimation,
          // Keep this cover fully opaque. The levels modal fades away over
          // the already prepared next board, preventing a blank/old frame.
          Animated.delay(360),
        ])
      : Animated.sequence([
          entranceAnimation,
          Animated.delay(520),
          Animated.timing(exitOpacity, {
            toValue: 0,
            duration: 360,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: false,
          }),
        ]);
    animation.start(({ finished }) => {
      if (!finished || finishedRef.current) return;
      finishedRef.current = true;
      onFinishedRef.current();
    });
    return () => animation.stop();
  }, [entrance, exitOpacity, group.id, level?.globalIndex]);

  return (
    <Animated.View
      style={[styles.layerEntryScene, { opacity: exitOpacity }]}
      accessibilityViewIsModal
    >
      <ImageBackground
        source={LAYER_THEMES[group.size].image}
        resizeMode="cover"
        style={styles.layerEntryBackground}
        imageStyle={styles.layerEntryBackgroundImage}
      >
        <View style={styles.layerEntryVeil} />
        <Animated.View
          style={[
            styles.layerEntryRing,
            {
              borderColor: LAYER_THEMES[group.size].accent,
              opacity: entrance.interpolate({
                inputRange: [0, 0.35, 1],
                outputRange: [0, 0.5, 0],
              }),
              transform: [
                {
                  scale: entrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.45, 2.05],
                  }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.layerEntryRing,
            {
              borderColor: LAYER_THEMES[group.size].accent,
              opacity: entrance.interpolate({
                inputRange: [0, 0.55, 1],
                outputRange: [0, 0.35, 0],
              }),
              transform: [
                {
                  scale: entrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.35, 2.65],
                  }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.layerEntryContent,
            {
              opacity: entrance,
              transform: [
                {
                  translateY: entrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [38, 0],
                  }),
                },
                {
                  scale: entrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.7, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.layerEntryFlowerWrap}>
            <Flower
              color={LAYER_THEMES[group.size].accent}
              size={level ? 88 : 116}
            />
          </View>
          {!level && (
            <>
              <Text style={styles.layerEntryOverline}>
                {translated(
                  language,
                  "YENİ BAHÇE HAZIR",
                  "NEW GARDEN READY"
                )}
              </Text>
              <Text style={styles.layerEntryTitle}>
                {group.cols}×{group.rows}{" "}
                {language === "en"
                  ? EN_DIFFICULTY_LABELS[group.difficulty]
                  : DIFFICULTY_LABELS[group.difficulty]}
              </Text>
              <Text style={styles.layerEntryText}>
                {translated(
                  language,
                  "İlk bölüm açılıyor...",
                  "Opening the first level..."
                )}
              </Text>
            </>
          )}
        </Animated.View>
      </ImageBackground>
    </Animated.View>
  );
}

function AppContent() {
  const { width: screenWidth, height: screenHeight } =
    useWindowDimensions();
  const insets = useSafeAreaInsets();
  const musicPlayer = useAudioPlayer(
    require("./assets/audio/garden-loop.wav"),
    { updateInterval: 1000, keepAudioSessionActive: true }
  );
  const tapPlayer = useAudioPlayer(require("./assets/audio/tap.wav"), {
    keepAudioSessionActive: true,
  });
  const ripplePlayer = useAudioPlayer(
    require("./assets/audio/ripple.wav"),
    { keepAudioSessionActive: true }
  );
  const successPlayer = useAudioPlayer(
    require("./assets/audio/success.wav"),
    { keepAudioSessionActive: true }
  );
  const unlockPlayer = useAudioPlayer(
    require("./assets/audio/unlock.wav"),
    { keepAudioSessionActive: true }
  );
  const [progress, setProgress] =
    useState<PlayerProgress>(DEFAULT_PROGRESS);
  const progressRef = useRef<PlayerProgress>(DEFAULT_PROGRESS);
  const purchaseSuccessHandlerRef = useRef<
    (purchase: IapPurchase) => Promise<void>
  >(async () => {});
  const purchaseErrorHandlerRef = useRef<
    (error: { code?: string; message: string }) => void
  >(() => {});
  const language = progress.language;
  const tx = (turkish: string, english: string) =>
    translated(language, turkish, english);
  const [progressReady, setProgressReady] = useState(false);
  const [screen, setScreen] = useState<"home" | "game">("home");
  const [openingVisible, setOpeningVisible] = useState(true);
  const [languageWelcomeVisible, setLanguageWelcomeVisible] =
    useState(false);
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [tutorialTargetIndex, setTutorialTargetIndex] = useState(0);
  const [warmupCelebrationVisible, setWarmupCelebrationVisible] =
    useState(false);
  const [homeReady, setHomeReady] = useState(false);
  const [homeLogoTarget, setHomeLogoTarget] =
    useState<OpeningLogoTarget | null>(null);
  const [levelIndex, setLevelIndex] = useState(0);
  const [board, setBoard] = useState([...LEVELS[0].initial]);
  const [direction, setDirection] = useState<Direction>(1);
  const [moveCount, setMoveCount] = useState(0);
  const [remainingSolution, setRemainingSolution] = useState([
    ...LEVELS[0].solution,
  ]);
  const [won, setWon] = useState(false);
  const [levelMenu, setLevelMenu] = useState(false);
  const [shopVisible, setShopVisible] = useState(false);
  const [shopMessage, setShopMessage] = useState<{
    title: string;
    message: string;
    icon?: "layer" | "adFree";
  } | null>(null);
  const [purchaseHistoryVisible, setPurchaseHistoryVisible] = useState(false);
  const [iapProducts, setIapProducts] = useState<IapProduct[]>([]);
  const [iapConnected, setIapConnected] = useState(false);
  const [iapProcessingProductId, setIapProcessingProductId] = useState<
    StoreProductId | null
  >(null);
  const [iapRestoreBusy, setIapRestoreBusy] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [resetConfirmVisible, setResetConfirmVisible] = useState(false);
  const [hintPromptMode, setHintPromptMode] = useState<
    "confirm" | "insufficient" | null
  >(null);
  const [requestedMove, setRequestedMove] = useState<
    (Move & { requestId: number }) | null
  >(null);
  const [winReward, setWinReward] = useState({
    stars: 1,
    hintCoins: 0,
    layerCoins: 0,
    hintBalanceBefore: 0,
    layerBalanceBefore: 0,
    firstCompletion: false,
    doubled: false,
  });
  const rewardedAdRef = useRef<RewardedAdInstance | null>(null);
  const rewardedAdCleanupRef = useRef<Array<() => void>>([]);
  const grantDoubleRewardRef = useRef<() => void>(() => {});
  const rewardedAdPreparationStartedRef = useRef(false);
  const rewardedAdLoadRef = useRef<() => void>(() => {});
  const rewardedAdLoadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [adPreparationAttempt, setAdPreparationAttempt] = useState(0);
  const interstitialAdRef = useRef<InterstitialAdInstance | null>(null);
  const interstitialAdCleanupRef = useRef<Array<() => void>>([]);
  const interstitialCompletionPendingRef = useRef(false);
  const revealCompletionRewardRef = useRef<() => void>(() => {});
  const [rewardedAdState, setRewardedAdState] = useState<
    "loading" | "ready" | "showing" | "error"
  >("loading");
  const [interstitialAdState, setInterstitialAdState] = useState<
    "loading" | "ready" | "showing" | "error"
  >("loading");
  const [selectedGroupId, setSelectedGroupId] = useState(
    PROGRESSION_GROUPS[0].id
  );
  const [modePickerOpen, setModePickerOpen] = useState(false);
  const [unlockCandidate, setUnlockCandidate] =
    useState<ProgressionGroup | null>(null);
  const [blockedGroupCandidate, setBlockedGroupCandidate] =
    useState<ProgressionGroup | null>(null);
  const [layerCelebration, setLayerCelebration] =
    useState<ProgressionGroup | null>(null);
  const [layerEntry, setLayerEntry] =
    useState<ProgressionGroup | null>(null);
  const [pendingAutoLevel, setPendingAutoLevel] =
    useState<Level | null>(null);
  const [recentlyUnlockedKey, setRecentlyUnlockedKey] =
    useState<string | null>(null);
  const [recentlyCompletedKey, setRecentlyCompletedKey] =
    useState<string | null>(null);
  const [levelMenuFocusKey, setLevelMenuFocusKey] =
    useState<string | null>(null);
  const [boardBusy, setBoardBusy] = useState(false);
  const homeEntrance = useRef(new Animated.Value(0)).current;
  const tutorialShownThisSession = useRef(false);
  const homeLogoTargetRef = useRef<View>(null);
  const levelListRef = useRef<FlatList<Level>>(null);
  const level = LEVELS[levelIndex] ?? LEVELS[0];
  const theme = LAYER_THEMES[level.size];
  const renderHomeContent =
    screen === "home" && !(Platform.OS === "android" && openingVisible);
  const currentBoardGeometry = boardGeometry(
    screenWidth,
    screenHeight,
    level
  );
  const compactGameLayout =
    isWarmupLevel(level) || screenHeight < 720 || screenWidth < 360;
  const veryCompactGameLayout = screenHeight < 680 || screenWidth < 340;
  const usableGameHeight =
    screenHeight - insets.top - insets.bottom;
  const estimatedGameHeight =
    currentBoardGeometry.boardHeight + (compactGameLayout ? 258 : 304);
  const allowGameScroll = usableGameHeight < estimatedGameHeight - 10;
  const extraGameHeight = Math.max(
    0,
    usableGameHeight - estimatedGameHeight
  );
  const gameTopPadding = compactGameLayout
    ? veryCompactGameLayout
      ? 2
      : 4
    : 10 + Math.min(88, extraGameHeight * 0.3);
  const gameSectionGap = compactGameLayout
    ? veryCompactGameLayout
      ? 3
      : 6
    : 11 + Math.min(17, extraGameHeight * 0.06);
  const compactControlStyle = compactGameLayout
    ? {
        width: veryCompactGameLayout ? 54 : 60,
        height: veryCompactGameLayout ? 47 : 52,
        borderRadius: veryCompactGameLayout ? 15 : 16,
      }
    : null;
  const compactDirectionStyle = compactGameLayout
    ? {
        minWidth: veryCompactGameLayout ? 64 : 72,
        height: veryCompactGameLayout ? 36 : 38,
        paddingHorizontal: veryCompactGameLayout ? 5 : 7,
      }
    : null;
  const actionIconSize = veryCompactGameLayout
    ? 34
    : compactGameLayout
      ? 39
      : 45;
  const directionIconSize = compactGameLayout ? 27 : 31;
  const modalSafePadding = {
    paddingTop: Math.max(16, insets.top + 8),
    paddingBottom: Math.max(16, insets.bottom + 8),
    paddingLeft: Math.max(16, insets.left + 12),
    paddingRight: Math.max(16, insets.right + 12),
  };
  const compactLevelMenu = screenHeight < 720 || screenWidth < 350;
  const completed = useMemo(
    () => new Set(Object.keys(progress.results)),
    [progress.results]
  );

  function playEffect(player: AudioPlayer) {
    if (!progress.soundEnabled) return;
    try {
      void player
        .seekTo(0)
        .then(() => player.play())
        .catch(() => {
          // Audio feedback must never block gameplay.
        });
    } catch {
      // A device audio interruption must never block gameplay.
    }
  }

  function measureHomeLogoTarget() {
    requestAnimationFrame(() => {
      homeLogoTargetRef.current?.measureInWindow(
        (x, y, width, measuredHeight) => {
          setHomeLogoTarget({
            x,
            y,
            width,
            height: measuredHeight,
          });
        }
      );
    });
  }

  useEffect(() => {
    let active = true;
    void loadProgress().then((saved) => {
      if (!active) return;
      const savedLevelIndex = LEVELS.findIndex(
        (item) => levelKey(item) === saved.currentLevelKey
      );
      const resumeIndex = savedLevelIndex >= 0 ? savedLevelIndex : 0;
      const resumeLevel = LEVELS[resumeIndex];
      progressRef.current = saved;
      setProgress(saved);
      setLevelIndex(resumeIndex);
      setBoard([...resumeLevel.initial]);
      setDirection(1);
      setMoveCount(0);
      setRemainingSolution([...resumeLevel.solution]);
      setSelectedGroupId(progressionGroupForLevel(resumeLevel).id);
      setLevelMenuFocusKey(levelKey(resumeLevel));
      setProgressReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    if (!progressReady || !ExpoIap) {
      setIapConnected(false);
      return;
    }
    let active = true;
    let purchaseSubscription: { remove: () => void } | null = null;
    let errorSubscription: { remove: () => void } | null = null;

    const restoreAdFreeEntitlement = async () => {
      const available = await ExpoIap.getAvailablePurchases({
        onlyIncludeActiveItemsIOS: true,
      });
      if (
        active &&
        available.some(
          (purchase) => purchase.productId === REMOVE_ADS_PRODUCT_ID
        ) &&
        !progressRef.current.adsRemoved
      ) {
        const next = { ...progressRef.current, adsRemoved: true };
        progressRef.current = next;
        setProgress(next);
        await saveProgress(next);
      }
    };

    const prepareStore = async () => {
      try {
        await ExpoIap.initConnection();
        if (!active) return;
        purchaseSubscription = ExpoIap.purchaseUpdatedListener((purchase) => {
          void purchaseSuccessHandlerRef.current(purchase);
        });
        errorSubscription = ExpoIap.purchaseErrorListener((error) => {
          purchaseErrorHandlerRef.current(error);
        });
        setIapConnected(true);
        const products = await ExpoIap.fetchProducts({
          skus: STORE_PRODUCT_IDS,
          type: "in-app",
        });
        if (active) {
          setIapProducts(
            (products ?? []).filter(
              (product): product is IapProduct => product.type === "in-app"
            )
          );
        }
        await restoreAdFreeEntitlement();
      } catch (error) {
        if (__DEV__) console.warn("Store preparation failed", error);
        if (active) setIapConnected(false);
      }
    };

    void prepareStore();
    return () => {
      active = false;
      purchaseSubscription?.remove();
      errorSubscription?.remove();
      setIapConnected(false);
      void ExpoIap.endConnection().catch(() => {});
    };
  }, [progressReady]);

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      interruptionMode: "mixWithOthers",
    }).catch(() => {
      // The game remains fully playable if the device rejects an audio session.
    });
  }, []);

  useEffect(() => {
    if (!progressReady || openingVisible) return;
    setLanguageWelcomeVisible(!progress.languageChosen);
  }, [openingVisible, progress.languageChosen, progressReady]);

  useEffect(() => {
    if (!openingVisible) return;
    // Fail-safe for native animation interruptions during a cold iOS launch.
    // The opening scene is decorative and must never trap the app behind an
    // invisible full-screen layer.
    const openingSafetyTimer = setTimeout(() => {
      setHomeReady(true);
      setOpeningVisible(false);
      if (progressReady) {
        setLanguageWelcomeVisible(!progress.languageChosen);
      }
    }, 5200);
    return () => clearTimeout(openingSafetyTimer);
  }, [openingVisible, progress.languageChosen, progressReady]);

  useEffect(() => {
    if (
      !progressReady ||
      openingVisible ||
      languageWelcomeVisible ||
      rewardedAdPreparationStartedRef.current
    ) {
      return;
    }
    if (progress.adsRemoved) {
      setRewardedAdState("error");
      setInterstitialAdState("error");
      return;
    }
    if (!ADMOB_ENABLED) {
      setRewardedAdState("error");
      setInterstitialAdState("error");
      return;
    }
    rewardedAdPreparationStartedRef.current = true;
    let active = true;

    function clearRewardedAdLoadTimeout() {
      if (rewardedAdLoadTimeoutRef.current) {
        clearTimeout(rewardedAdLoadTimeoutRef.current);
        rewardedAdLoadTimeoutRef.current = null;
      }
    }

    async function prepareRewardedAd() {
      setRewardedAdState("loading");
      setInterstitialAdState("loading");
      try {
        let canRequestAds = true;
        try {
          await AdsConsent!.gatherConsent();
          const consentInfo = await AdsConsent!.getConsentInfo();
          canRequestAds = consentInfo.canRequestAds;
        } catch (error) {
          // If the AdMob consent form is not configured yet, do not block the
          // game or retry forever during testing. Ads still request in a safe,
          // non-personalized mode where required below.
          console.warn("Ad consent preparation failed", error);
        }

        if (!active || !canRequestAds) {
          if (active) {
            setRewardedAdState("error");
            setInterstitialAdState("error");
          }
          return;
        }

        await mobileAds!().initialize();
        if (!active) return;

        if (REWARDED_ADS_ENABLED) {
          const rewardedAd = RewardedAd!.createForAdRequest(
            ADMOB_REWARDED_AD_UNIT_ID,
            { requestNonPersonalizedAdsOnly: Platform.OS === "ios" }
          );
          rewardedAdRef.current = rewardedAd;
          const loadRewardedAd = () => {
            if (!active) return;
            clearRewardedAdLoadTimeout();
            setRewardedAdState("loading");
            rewardedAd.load();
            rewardedAdLoadTimeoutRef.current = setTimeout(() => {
              if (active) setRewardedAdState("error");
            }, 20000);
          };
          rewardedAdLoadRef.current = loadRewardedAd;
          rewardedAdCleanupRef.current.forEach((unsubscribe) => unsubscribe());
          rewardedAdCleanupRef.current = [
            rewardedAd.addAdEventListener(
              RewardedAdEventType!.LOADED,
              () => {
                clearRewardedAdLoadTimeout();
                if (active) setRewardedAdState("ready");
              }
            ),
            rewardedAd.addAdEventListener(
              RewardedAdEventType!.EARNED_REWARD,
              () => {
                if (active) grantDoubleRewardRef.current();
              }
            ),
            rewardedAd.addAdEventListener(AdEventType!.CLOSED, () => {
              if (!active) return;
              loadRewardedAd();
            }),
            rewardedAd.addAdEventListener(AdEventType!.ERROR, (error) => {
              clearRewardedAdLoadTimeout();
              if (active) {
                console.warn("Rewarded ad failed to load", error);
                setRewardedAdState("error");
              }
            }),
          ];
          loadRewardedAd();
        } else {
          setRewardedAdState("error");
        }

        if (INTERSTITIAL_ADS_ENABLED) {
          const interstitialAd = InterstitialAd!.createForAdRequest(
            ADMOB_INTERSTITIAL_AD_UNIT_ID,
            { requestNonPersonalizedAdsOnly: Platform.OS === "ios" }
          );
          interstitialAdRef.current = interstitialAd;
          interstitialAdCleanupRef.current.forEach((unsubscribe) =>
            unsubscribe()
          );
          interstitialAdCleanupRef.current = [
            interstitialAd.addAdEventListener(AdEventType!.LOADED, () => {
              if (active) setInterstitialAdState("ready");
            }),
            interstitialAd.addAdEventListener(AdEventType!.CLOSED, () => {
              if (!active) return;
              setInterstitialAdState("loading");
              revealCompletionRewardRef.current();
              interstitialAd.load();
            }),
            interstitialAd.addAdEventListener(AdEventType!.ERROR, (error) => {
              if (!active) return;
              console.warn("Interstitial ad failed to load", error);
              setInterstitialAdState("error");
              revealCompletionRewardRef.current();
            }),
          ];
          interstitialAd.load();
        } else {
          setInterstitialAdState("error");
        }
      } catch (error) {
        if (active) {
          console.warn("Google Mobile Ads initialization failed", error);
          rewardedAdPreparationStartedRef.current = false;
          setRewardedAdState("error");
          setInterstitialAdState("error");
        }
      }
    }

    void prepareRewardedAd();
    return () => {
      active = false;
      rewardedAdCleanupRef.current.forEach((unsubscribe) => unsubscribe());
      rewardedAdCleanupRef.current = [];
      clearRewardedAdLoadTimeout();
      rewardedAdLoadRef.current = () => {};
      rewardedAdRef.current = null;
      interstitialAdCleanupRef.current.forEach((unsubscribe) =>
        unsubscribe()
      );
      interstitialAdCleanupRef.current = [];
      interstitialAdRef.current = null;
      interstitialCompletionPendingRef.current = false;
      rewardedAdPreparationStartedRef.current = false;
    };
  }, [
    adPreparationAttempt,
    languageWelcomeVisible,
    openingVisible,
    progress.adsRemoved,
    progressReady,
  ]);

  useEffect(() => {
    try {
      musicPlayer.loop = true;
      musicPlayer.volume = 0.16;
      if (!progressReady) return;
      if (progress.musicEnabled) {
        musicPlayer.play();
      } else {
        musicPlayer.pause();
      }
    } catch {
      // Audio interruptions are non-fatal and gameplay continues silently.
    }
  }, [musicPlayer, progress.musicEnabled, progressReady]);

  useEffect(() => {
    if (!progressReady) return;
    void saveProgress(progress);
  }, [progress, progressReady]);

  useEffect(() => {
    if (screen !== "home" || !homeReady) return;
    homeEntrance.setValue(0);
    const entrance = Animated.timing(homeEntrance, {
      toValue: 1,
      duration: 1650,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    entrance.start();
    return () => entrance.stop();
  }, [screen, homeReady, homeEntrance]);

  const correctCount = useMemo(
    () =>
      board.reduce(
        (total, value, index) =>
          total + (value === level.target[index] ? 1 : 0),
        0
      ),
    [board, level]
  );

  const selectedGroup =
    PROGRESSION_GROUPS.find((group) => group.id === selectedGroupId) ??
    PROGRESSION_GROUPS[0];
  const selectedLevels = selectedGroup.levels;
  const levelModeTheme =
    LEVEL_MODE_THEMES[selectedGroup.difficulty];

  function isGroupUnlocked(group: ProgressionGroup) {
    if (PROMO_SCREENSHOT_MODE) return true;
    return progress.unlockedGroupIds.includes(group.id);
  }

  function previousGroupFor(group: ProgressionGroup) {
    const index = PROGRESSION_GROUPS.findIndex(
      (candidate) => candidate.id === group.id
    );
    return index > 0 ? PROGRESSION_GROUPS[index - 1] : null;
  }

  function canUnlockGroup(group: ProgressionGroup) {
    const previousGroup = previousGroupFor(group);
    return Boolean(previousGroup && isGroupUnlocked(previousGroup));
  }

  function isLevelUnlocked(item: Level) {
    if (PROMO_SCREENSHOT_MODE) return true;
    const group = progressionGroupForLevel(item);
    if (!isGroupUnlocked(group)) return false;
    const index = group.levels.findIndex(
      (groupLevel) => levelKey(groupLevel) === levelKey(item)
    );
    return index === 0 || completed.has(levelKey(group.levels[index - 1]));
  }

  useEffect(() => {
    const focusKey = recentlyUnlockedKey ?? levelMenuFocusKey;
    if (!levelMenu || !focusKey) return;
    const index = selectedLevels.findIndex(
      (item) => levelKey(item) === focusKey
    );
    if (index < 0) return;
    const rowIndex = Math.floor(index / 5);
    const groupIdAtSchedule = selectedGroupId;
    const timer = setTimeout(() => {
      if (
        groupIdAtSchedule !== selectedGroupId ||
        !levelListRef.current
      ) {
        return;
      }
      levelListRef.current.scrollToOffset({
        offset: Math.max(0, (rowIndex - 1) * 86),
        animated: true,
      });
    }, 360);
    return () => clearTimeout(timer);
  }, [
    levelMenu,
    levelMenuFocusKey,
    recentlyUnlockedKey,
    selectedGroupId,
    selectedLevels,
  ]);

  useEffect(() => {
    if (
      !levelMenu ||
      !pendingAutoLevel ||
      unlockCandidate ||
      blockedGroupCandidate ||
      layerCelebration ||
      layerEntry
    ) {
      return;
    }
    const pendingGroup = progressionGroupForLevel(pendingAutoLevel);
    if (pendingGroup.id !== selectedGroupId) return;
    // Let the level screen fade in, scroll to the newly unlocked tile and
    // finish its unlock animation before opening the next puzzle.
    const timer = setTimeout(() => {
      finishAutoLevelEntry(pendingAutoLevel);
    }, 2250);
    return () => clearTimeout(timer);
  }, [
    layerCelebration,
    layerEntry,
    levelMenu,
    pendingAutoLevel,
    selectedGroupId,
    blockedGroupCandidate,
    unlockCandidate,
  ]);

  useEffect(() => {
    if (!layerCelebration) return;
    const timer = setTimeout(() => {
      beginLayerEntry(layerCelebration);
    }, 1600);
    return () => clearTimeout(timer);
  }, [layerCelebration]);

  function loadLevel(index: number) {
    const next = LEVELS[index];
    if (!next) return;
    if (!isLevelUnlocked(next)) return;
    setProgress((previous) => ({
      ...previous,
      currentLevelKey: levelKey(next),
    }));
    setPendingAutoLevel(null);
    setLevelIndex(index);
    setBoard([...next.initial]);
    setDirection(1);
    setMoveCount(0);
    setRemainingSolution([...next.solution]);
    setRequestedMove(null);
    setWon(false);
    setRecentlyCompletedKey(null);
    setBoardBusy(false);
    setLevelMenuFocusKey(levelKey(next));
    setLevelMenu(false);
    setScreen("game");
    if (
      !progress.tutorialCompleted &&
      !tutorialShownThisSession.current
    ) {
      tutorialShownThisSession.current = true;
      setTutorialTargetIndex(index);
      setTutorialVisible(true);
    }
  }

  function finishAutoLevelEntry(next: Level) {
    loadLevel(next.globalIndex);
  }

  function completeFirstTutorial() {
    const firstLevel = LEVELS[tutorialTargetIndex] ?? LEVELS[0];
    setProgress((previous) => ({
      ...previous,
      currentLevelKey: levelKey(firstLevel),
      tutorialCompleted: true,
    }));
    setLevelIndex(firstLevel.globalIndex);
    setBoard([...firstLevel.initial]);
    setDirection(1);
    setMoveCount(0);
    setRemainingSolution([...firstLevel.solution]);
    setRequestedMove(null);
    setWon(false);
    setBoardBusy(false);
    setLevelMenu(false);
    setScreen("game");
    setTutorialVisible(false);
  }

  function chooseWelcomeLanguage(nextLanguage: AppLanguage) {
    if (!progressReady) return;
    playEffect(tapPlayer);
    setProgress((previous) => ({
      ...previous,
      language: nextLanguage,
      languageChosen: true,
    }));
    setLanguageWelcomeVisible(false);
  }

  function openLevelMenu() {
    if (boardBusy) return;
    setSelectedGroupId(progressionGroupForLevel(level).id);
    setLevelMenuFocusKey(levelKey(level));
    setRecentlyUnlockedKey(null);
    setLevelMenu(true);
  }

  function resetLevel() {
    if (boardBusy) return;
    setBoard([...level.initial]);
    setDirection(1);
    setMoveCount(0);
    setRemainingSolution([...level.solution]);
    setRequestedMove(null);
  }

  function handleRipple(
    row: number,
    col: number,
    moveDirection: Direction,
    nextBoard: number[]
  ) {
    if (won) return;
    const move: Move = { row, col, direction: moveDirection };
    const nextMoveCount = moveCount + 1;
    let nextSolution: Move[];

    if (
      remainingSolution.length > 0 &&
      sameMove(remainingSolution[0], move)
    ) {
      nextSolution = remainingSolution.slice(1);
    } else {
      nextSolution = [
        { row, col, direction: -moveDirection as Direction },
        ...remainingSolution,
      ];
    }

    setBoard([...nextBoard]);
    setMoveCount(nextMoveCount);
    setRemainingSolution(nextSolution);
    if (sameBoard(nextBoard, level.target)) {
      playEffect(successPlayer);
      const resultStars = starsForMoves(level, nextMoveCount);
      const key = levelKey(level);
      const firstCompletion = !progress.results[key];
      const earned = firstCompletion && !isWarmupLevel(level)
        ? rewardsFor(level.difficulty, resultStars)
        : { hintCoins: 0, layerCoins: 0 };
      const currentGroup = progressionGroupForLevel(level);
      const currentIndexInGroup = currentGroup.levels.findIndex(
        (item) => levelKey(item) === key
      );
      const nextLevelInGroup =
        currentGroup.levels[currentIndexInGroup + 1];
      setProgress((previous) => {
        const oldResult = previous.results[key];
        const nextResult = {
          stars: Math.max(oldResult?.stars ?? 0, resultStars),
          bestMoves: Math.min(oldResult?.bestMoves ?? nextMoveCount, nextMoveCount),
          completedAt: oldResult?.completedAt ?? new Date().toISOString(),
        };
        return {
          ...previous,
          results: { ...previous.results, [key]: nextResult },
          hintCoins: previous.hintCoins + earned.hintCoins,
          layerCoins: previous.layerCoins + earned.layerCoins,
          currentLevelKey: firstCompletion && nextLevelInGroup
            ? levelKey(nextLevelInGroup)
            : previous.currentLevelKey,
        };
      });
      setWinReward({
        stars: resultStars,
        hintCoins: earned.hintCoins,
        layerCoins: earned.layerCoins,
        hintBalanceBefore: progress.hintCoins,
        layerBalanceBefore: progress.layerCoins,
        firstCompletion,
        doubled: false,
      });
      if (progress.hapticsEnabled) {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success
        ).catch(() => {});
      }
      const completedLevelCountAfter =
        Object.keys(progress.results).length + (firstCompletion ? 1 : 0);
      const isScheduledInterstitial =
        firstCompletion &&
        completedLevelCountAfter >= 12 &&
        (completedLevelCountAfter - 12) % 3 === 0;
      const shouldShowInterstitial =
        !progress.adsRemoved &&
        isScheduledInterstitial &&
        interstitialAdState === "ready" &&
        Boolean(interstitialAdRef.current);

      if (shouldShowInterstitial) {
        interstitialCompletionPendingRef.current = true;
        setInterstitialAdState("showing");
        void interstitialAdRef.current!.show().catch(() => {
          setInterstitialAdState("error");
          revealCompletionRewardRef.current();
        });
      } else {
        if (
          interstitialAdState === "error" &&
          interstitialAdRef.current
        ) {
          setInterstitialAdState("loading");
          interstitialAdRef.current.load();
        }
        setWon(true);
      }
    }
  }

  function showHint() {
    if (boardBusy) return;
    const hint = remainingSolution[0];
    if (!hint) {
      return;
    }
    if (progress.freeHints <= 0) {
      if (progress.hintCoins < HINT_PRICE) {
        setHintPromptMode("insufficient");
        return;
      }
      if (!progress.paidHintConfirmed) {
        setHintPromptMode("confirm");
        return;
      }
      spendPaidHint(hint);
      return;
    }
    setProgress((previous) => ({
      ...previous,
      freeHints: previous.freeHints - 1,
    }));
    applyHintMove(hint);
  }

  function applyHintMove(hint: Move) {
    setDirection(hint.direction);
    setRequestedMove({ ...hint, requestId: Date.now() });
  }

  function spendPaidHint(hint: Move) {
    setProgress((previous) => ({
      ...previous,
      hintCoins: Math.max(0, previous.hintCoins - HINT_PRICE),
    }));
    applyHintMove(hint);
  }

  function confirmPaidHint() {
    const hint = remainingSolution[0];
    if (!hint || progress.hintCoins < HINT_PRICE) {
      setHintPromptMode("insufficient");
      return;
    }
    setProgress((previous) => ({
      ...previous,
      hintCoins: previous.hintCoins - HINT_PRICE,
      paidHintConfirmed: true,
    }));
    setHintPromptMode(null);
    applyHintMove(hint);
  }

  function grantDoubleReward() {
    if (
      !winReward.firstCompletion ||
      winReward.doubled ||
      (winReward.hintCoins === 0 && winReward.layerCoins === 0)
    ) {
      return;
    }
    setProgress((previous) => ({
      ...previous,
      hintCoins: previous.hintCoins + winReward.hintCoins,
      layerCoins: previous.layerCoins + winReward.layerCoins,
    }));
    setWinReward((previous) => ({ ...previous, doubled: true }));
    if (progress.hapticsEnabled) {
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success
      ).catch(() => {});
    }
  }

  grantDoubleRewardRef.current = grantDoubleReward;

  revealCompletionRewardRef.current = () => {
    if (!interstitialCompletionPendingRef.current) return;
    interstitialCompletionPendingRef.current = false;
    setWon(true);
  };

  function queueCompletionNavigation(navigation: () => void) {
    // Both changes are batched in one render. The reward modal fades out at
    // the same time as the level modal fades in, so the game board or an
    // intermediate decoration can never flash between the two screens.
    setWon(false);
    navigation();
  }

  async function showRewardedAd() {
    if (
      !winReward.firstCompletion ||
      winReward.doubled ||
      rewardedAdState === "showing" ||
      (winReward.hintCoins === 0 && winReward.layerCoins === 0)
    ) {
      return;
    }
    playEffect(tapPlayer);
    const rewardedAd = rewardedAdRef.current;
    if (!rewardedAd || rewardedAdState !== "ready") {
      setRewardedAdState("loading");
      if (rewardedAd) {
        rewardedAdLoadRef.current();
      } else {
        rewardedAdPreparationStartedRef.current = false;
        setAdPreparationAttempt((attempt) => attempt + 1);
      }
      return;
    }
    setRewardedAdState("showing");
    try {
      await rewardedAd.show();
    } catch {
      setRewardedAdState("error");
    }
  }

  function continueAfterCompletion() {
    const group = progressionGroupForLevel(level);
    const indexInGroup = group.levels.findIndex(
      (item) => levelKey(item) === levelKey(level)
    );
    if (
      isWarmupLevel(level) &&
      indexInGroup === group.levels.length - 1
    ) {
      queueCompletionNavigation(() => {
        setRecentlyCompletedKey(levelKey(level));
        setPendingAutoLevel(null);
        setLevelMenu(false);
        setWarmupCelebrationVisible(true);
      });
      return;
    }

    if (indexInGroup < group.levels.length - 1) {
      const next = group.levels[indexInGroup + 1];
      queueCompletionNavigation(() => {
        setRecentlyCompletedKey(levelKey(level));
        setSelectedGroupId(group.id);
        setLevelMenuFocusKey(levelKey(next));
        setRecentlyUnlockedKey(levelKey(next));
        setPendingAutoLevel(next);
        setLevelMenu(true);
      });
      return;
    }

    const groupIndex = PROGRESSION_GROUPS.findIndex(
      (item) => item.id === group.id
    );
    const nextGroup = PROGRESSION_GROUPS[groupIndex + 1];
    queueCompletionNavigation(() => {
      setRecentlyCompletedKey(levelKey(level));
      if (nextGroup) {
        setSelectedGroupId(nextGroup.id);
        setLevelMenuFocusKey(levelKey(nextGroup.levels[0]));
        if (isGroupUnlocked(nextGroup)) {
          setRecentlyUnlockedKey(levelKey(nextGroup.levels[0]));
          setPendingAutoLevel(nextGroup.levels[0]);
        } else {
          setPendingAutoLevel(null);
          setUnlockCandidate(nextGroup);
        }
      } else {
        setSelectedGroupId(group.id);
        setLevelMenuFocusKey(levelKey(level));
        setPendingAutoLevel(null);
      }
      setLevelMenu(true);
    });
  }

  function continueAfterWarmupCelebration() {
    const firstMainGroup = PROGRESSION_GROUPS.find(
      (group) => group.layoutId === "3x3" && group.difficulty === "easy"
    );
    if (!firstMainGroup) return;
    playEffect(unlockPlayer);
    setWarmupCelebrationVisible(false);
    setSelectedGroupId(firstMainGroup.id);
    setLevelMenuFocusKey(levelKey(firstMainGroup.levels[0]));
    setRecentlyUnlockedKey(levelKey(firstMainGroup.levels[0]));
    setPendingAutoLevel(null);
    setLevelMenu(true);
    setLayerEntry(firstMainGroup);
  }

  function tryOpenGroup(group: ProgressionGroup) {
    if (isGroupUnlocked(group)) {
      setSelectedGroupId(group.id);
      const focusLevel =
        group.levels.find(
          (item) =>
            isLevelUnlocked(item) && !completed.has(levelKey(item))
        ) ?? group.levels[group.levels.length - 1];
      setLevelMenuFocusKey(levelKey(focusLevel));
      setRecentlyUnlockedKey(null);
      return;
    }
    if (!canUnlockGroup(group)) {
      setBlockedGroupCandidate(group);
      return;
    }
    setUnlockCandidate(group);
  }

  function unlockGroup(group: ProgressionGroup) {
    if (
      !canUnlockGroup(group) ||
      progress.layerCoins < group.unlockCost
    ) {
      return;
    }
    playEffect(unlockPlayer);
    setProgress((previous) => ({
      ...previous,
      layerCoins: previous.layerCoins - group.unlockCost,
      unlockedGroupIds: [
        ...new Set([...previous.unlockedGroupIds, group.id]),
      ],
    }));
    setSelectedGroupId(group.id);
    setLevelMenuFocusKey(levelKey(group.levels[0]));
    setPendingAutoLevel(null);
    setUnlockCandidate(null);
    setLevelMenu(true);
    setLayerCelebration(group);
    setRecentlyUnlockedKey(levelKey(group.levels[0]));
  }

  function beginLayerEntry(group: ProgressionGroup) {
    setLayerCelebration(null);
    setLayerEntry(group);
  }

  function finishLayerEntry(group: ProgressionGroup) {
    loadLevel(group.levels[0].globalIndex);
    setLayerEntry(null);
  }

  function isStoreProductId(value: string): value is StoreProductId {
    return value in STORE_PRODUCT_CATALOG;
  }

  function storeProduct(productId: StoreProductId) {
    return iapProducts.find((product) => product.id === productId);
  }

  function storePrice(productId: StoreProductId) {
    return (
      storeProduct(productId)?.displayPrice ??
      STORE_PRODUCT_CATALOG[productId].fallbackPrice
    );
  }

  function purchaseTitle(productId: StoreProductId, language: AppLanguage) {
    const names: Record<StoreProductId, [string, string]> = {
      hint_coins_60: ["Filiz Paketi", "Sprout Pack"],
      hint_coins_200: ["Çiçek Paketi", "Flower Pack"],
      hint_coins_500: ["Bahçe Paketi", "Garden Pack"],
      layer_coins_100: ["Küçük Anahtar", "Small Key"],
      layer_coins_350: ["Bahçe Anahtarı", "Garden Key"],
      layer_coins_900: ["Usta Anahtar", "Master Key"],
      remove_ads: ["Reklamları Kaldır", "Remove Ads"],
    };
    return translated(language, names[productId][0], names[productId][1]);
  }

  purchaseSuccessHandlerRef.current = async (purchase) => {
    if (!ExpoIap || !isStoreProductId(purchase.productId)) {
      setIapProcessingProductId(null);
      return;
    }
    if (purchase.purchaseState === "pending") {
      setIapProcessingProductId(null);
      setShopMessage({
        title: tx("Satın alma beklemede", "Purchase Pending"),
        message: tx(
          "Ödeme mağaza tarafından onaylandığında ürün otomatik olarak hesabına eklenecek.",
          "The item will be added automatically after the store approves the payment."
        ),
      });
      return;
    }

    const productId = purchase.productId;
    const product = STORE_PRODUCT_CATALOG[productId];
    const transactionId = purchase.id;
    const alreadyGranted =
      progressRef.current.processedTransactionIds.includes(transactionId);
    try {
      if (!alreadyGranted) {
        const previous = progressRef.current;
        const purchaseLanguage = previous.language;
        const next: PlayerProgress = {
          ...previous,
          hintCoins:
            product.currency === "hint"
              ? previous.hintCoins + product.amount
              : previous.hintCoins,
          layerCoins:
            product.currency === "layer"
              ? previous.layerCoins + product.amount
              : previous.layerCoins,
          adsRemoved:
            product.currency === "adFree" ? true : previous.adsRemoved,
          processedTransactionIds: [
            transactionId,
            ...previous.processedTransactionIds.filter(
              (id) => id !== transactionId
            ),
          ].slice(0, 250),
          purchaseHistory: [
            {
              id: transactionId,
              productId,
              title: purchaseTitle(productId, purchaseLanguage),
              price: storePrice(productId),
              purchasedAt: new Date(
                purchase.transactionDate || Date.now()
              ).toISOString(),
            },
            ...previous.purchaseHistory.filter(
              (record) => record.id !== transactionId
            ),
          ].slice(0, 100),
        };
        progressRef.current = next;
        setProgress(next);
        await saveProgress(next);
      }
      await ExpoIap.finishTransaction({
        purchase,
        isConsumable: product.currency !== "adFree",
      });
      if (!alreadyGranted) {
        setShopMessage({
          title: tx("Satın alma tamamlandı", "Purchase Complete"),
          icon: product.currency === "adFree" ? "adFree" : "layer",
          message:
            product.currency === "adFree"
              ? tx(
                  "Reklamlar kalıcı olarak kapatıldı.",
                  "Ads have been permanently disabled."
                )
              : tx(
                  `${product.amount} ${product.currency === "hint" ? "ipucu" : "katman"} parası hesabına eklendi.`,
                  `${product.amount} ${product.currency === "hint" ? "hint" : "layer"} coins were added to your balance.`
                ),
        });
      }
    } catch (error) {
      if (__DEV__) console.warn("Purchase finalization failed", error);
      setShopMessage({
        title: tx("İşlem tamamlanamadı", "Could Not Complete Purchase"),
        message: tx(
          "Satın alma mağazada tamamlandıysa uygulamayı yeniden aç. İşlem yeniden kontrol edilecek ve ürünün kaybolmayacak.",
          "If the store completed the purchase, reopen the app. The transaction will be checked again and your item will not be lost."
        ),
      });
    } finally {
      setIapProcessingProductId(null);
    }
  };

  purchaseErrorHandlerRef.current = (error) => {
    setIapProcessingProductId(null);
    if (error.code === "user-cancelled") return;
    setShopMessage({
      title: tx("Satın alma tamamlanamadı", "Purchase Unsuccessful"),
      message: tx(
        "Mağaza işlemi tamamlayamadı. İnternet bağlantını ve App Store veya Google Play hesabını kontrol edip yeniden dene.",
        "The store could not complete the transaction. Check your connection and App Store or Google Play account, then try again."
      ),
    });
  };

  async function requestStorePurchase(productId: StoreProductId) {
    if (iapProcessingProductId || progress.adsRemoved && productId === REMOVE_ADS_PRODUCT_ID) {
      return;
    }
    if (!ExpoIap || !iapConnected) {
      setShopMessage({
        title: tx("Mağaza hazırlanıyor", "Store Is Preparing"),
        message: tx(
          "Mağaza bağlantısı henüz hazır değil. Birkaç saniye sonra yeniden dene.",
          "The store connection is not ready yet. Please try again in a few seconds."
        ),
      });
      return;
    }
    if (!storeProduct(productId)) {
      setShopMessage({
        title: tx("Ürün kullanılamıyor", "Product Unavailable"),
        message: tx(
          "Bu ürün mağazadan alınamadı. Ürünün App Store Connect veya Play Console'da satışa hazır olduğundan emin ol.",
          "This product was not returned by the store. Make sure it is ready for sale in App Store Connect or Play Console."
        ),
      });
      return;
    }
    setIapProcessingProductId(productId);
    try {
      await ExpoIap.requestPurchase({
        request: {
          apple: { sku: productId, quantity: 1 },
          google: { skus: [productId] },
        },
        type: "in-app",
      });
    } catch (error) {
      if (__DEV__) console.warn("Purchase request failed", error);
      setIapProcessingProductId(null);
      setShopMessage({
        title: tx("Satın alma başlatılamadı", "Purchase Could Not Start"),
        message: tx(
          "Mağaza şu anda yanıt vermiyor. Lütfen daha sonra yeniden dene.",
          "The store is not responding right now. Please try again later."
        ),
      });
    }
  }

  async function restoreStorePurchases() {
    if (!ExpoIap || !iapConnected || iapRestoreBusy) return;
    setIapRestoreBusy(true);
    try {
      await ExpoIap.restorePurchases();
      const available = await ExpoIap.getAvailablePurchases({
        onlyIncludeActiveItemsIOS: true,
      });
      const ownsAdFree = available.some(
        (purchase) => purchase.productId === REMOVE_ADS_PRODUCT_ID
      );
      if (ownsAdFree && !progressRef.current.adsRemoved) {
        const next = { ...progressRef.current, adsRemoved: true };
        progressRef.current = next;
        setProgress(next);
        await saveProgress(next);
      }
      setShopMessage({
        title: ownsAdFree
          ? tx("Satın alma geri yüklendi", "Purchase Restored")
          : tx("Geri yüklenecek ürün yok", "Nothing to Restore"),
        icon: ownsAdFree ? "adFree" : "layer",
        message: ownsAdFree
          ? tx(
              "Reklamsız paket bu cihazda yeniden etkinleştirildi.",
              "The ad-free pack has been reactivated on this device."
            )
          : tx(
              "Bu mağaza hesabında geri yüklenebilir bir reklamsız paket bulunamadı.",
              "No restorable ad-free purchase was found for this store account."
            ),
      });
    } catch (error) {
      if (__DEV__) console.warn("Purchase restore failed", error);
      setShopMessage({
        title: tx("Geri yükleme başarısız", "Restore Failed"),
        message: tx(
          "Mağaza hesabı kontrol edilemedi. İnternet bağlantını kontrol edip yeniden dene.",
          "The store account could not be checked. Verify your connection and try again."
        ),
      });
    } finally {
      setIapRestoreBusy(false);
    }
  }

  function closeShop() {
    setShopMessage(null);
    setPurchaseHistoryVisible(false);
    setShopVisible(false);
  }

  function formatPurchaseDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(language === "tr" ? "tr-TR" : "en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <LanguageContext.Provider value={language}>
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safeArea, { backgroundColor: theme.background }]}
    >
      <ImageBackground
        source={screen === "home" ? LAYER_THEMES[3].image : theme.image}
        resizeMode="cover"
        style={styles.backgroundImage}
        imageStyle={styles.backgroundImageAsset}
      >
      <StatusBar style="dark" />
      <NativeStatusBar
        backgroundColor={theme.background}
        barStyle="dark-content"
      />
      {renderHomeContent ? (
        <ScrollView
          contentContainerStyle={[
            styles.homePage,
            { paddingBottom: Math.max(28, insets.bottom + 18) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.homeContent}>
            <Animated.View
              style={[
                styles.homeTopRow,
                {
                  opacity: homeEntrance.interpolate({
                    inputRange: [0, 0.12, 0.34],
                    outputRange: [0, 0, 1],
                    extrapolate: "clamp",
                  }),
                  transform: [
                    {
                      translateY: homeEntrance.interpolate({
                        inputRange: [0, 0.34],
                        outputRange: [-20, 0],
                        extrapolate: "clamp",
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.homeWallet}>
                <View style={styles.homeCurrency}>
                  <UiIcon source={UI_ICONS.hintCurrency} size={27} />
                  <Text style={styles.homeCurrencyText}>
                    {progress.hintCoins}
                  </Text>
                  {screenWidth >= 360 && (
                    <Text style={styles.homeCurrencyLabel}>
                      {tx("İPUCU", "HINT")}
                    </Text>
                  )}
                </View>
                <View style={styles.homeCurrency}>
                  <UiIcon source={UI_ICONS.layerCurrency} size={27} />
                  <Text style={styles.homeCurrencyText}>
                    {progress.layerCoins}
                  </Text>
                  {screenWidth >= 360 && (
                    <Text style={styles.homeCurrencyLabel}>
                      {tx("KATMAN", "LAYER")}
                    </Text>
                  )}
                </View>
              </View>
              <View style={styles.homeTopActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    progress.adsRemoved
                      ? tx("Reklamlar kapalı", "Ads are disabled")
                      : tx("Reklamları kaldır", "Remove ads")
                  }
                  onPress={() => {
                    playEffect(tapPlayer);
                    setShopVisible(true);
                  }}
                  style={({ pressed }) => [
                    styles.homeAdFreeButton,
                    progress.adsRemoved && styles.homeAdFreeButtonActive,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <AdFreeIcon size={31} active={progress.adsRemoved} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tx("Ayarları aç", "Open settings")}
                  onPress={() => {
                    playEffect(tapPlayer);
                    setSettingsVisible(true);
                  }}
                  style={styles.homeSettingsButton}
                >
                  {({ pressed }) => (
                    <AnimatedUiIcon
                      source={UI_ICONS.settings}
                      size={31}
                      pressed={pressed}
                    />
                  )}
                </Pressable>
              </View>
            </Animated.View>

            <Animated.View
              style={[
                styles.homeBrand,
                {
                  opacity: homeEntrance.interpolate({
                    inputRange: [0.52, 0.86],
                    outputRange: [0, 1],
                    extrapolate: "clamp",
                  }),
                },
            ]}
          >
              {openingVisible ? (
                <View
                  ref={homeLogoTargetRef}
                  onLayout={measureHomeLogoTarget}
                  style={styles.homeLogoPlaceholder}
                />
              ) : (
                <View style={styles.homeLogoSettledWrap}>
                  <Image
                    source={require("./assets/images/app-icon-bloomshift-v2.png")}
                    style={styles.homeLogo}
                  />
                </View>
              )}
              <Text style={styles.homeTitle}>Bloomshift</Text>
              <Text style={styles.homeSubtitle}>
                {tx(
                  "Renkleri döndür, bahçeyi uyandır.",
                  "Turn the colors, awaken the garden."
                )}
              </Text>
            </Animated.View>

            <Animated.View
              style={[
                styles.homeAnimatedSection,
                {
                  opacity: homeEntrance.interpolate({
                    inputRange: [0.5, 0.84],
                    outputRange: [0, 1],
                    extrapolate: "clamp",
                  }),
                  transform: [
                    {
                      translateY: homeEntrance.interpolate({
                        inputRange: [0.5, 0.84],
                        outputRange: [38, 0],
                        extrapolate: "clamp",
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.homeGardenPanel}>
                <Text style={styles.homeGardenBotanical}>❧</Text>
                <View style={styles.homeGardenPanelRow}>
                  <View style={styles.homeGardenArt}>
                    <View style={styles.homeGardenArtRing} />
                    {[...new Set(level.target)]
                      .slice(0, 3)
                      .map((colorIndex, index) => (
                        <View
                          key={`home-showcase-${colorIndex}`}
                          style={[
                            styles.homeGardenFlower,
                            index === 0 && styles.homeGardenFlowerLeft,
                            index === 1 && styles.homeGardenFlowerRight,
                            index === 2 && styles.homeGardenFlowerTop,
                          ]}
                        >
                          <Flower
                            color={paletteAt(colorIndex).main}
                            size={index === 2 ? 38 : 48}
                          />
                        </View>
                      ))}
                  </View>
                  <View style={styles.homeGardenCopy}>
                    <Text style={styles.homeGardenOverline}>
                      {tx("SIRADAKİ BAHÇE", "NEXT GARDEN")}
                    </Text>
                    <Text style={styles.homeGardenTitle}>
                      {isWarmupLevel(level)
                        ? tx("Isınma Turu", "Warm-up Tour")
                        : `${level.cols}×${level.rows} ${
                            language === "en"
                              ? EN_DIFFICULTY_LABELS[level.difficulty]
                              : DIFFICULTY_LABELS[level.difficulty]
                          }`}
                    </Text>
                    <Text style={styles.homeGardenMeta}>
                      {tx("Bölüm", "Level")}{" "}
                      {numberInProgressionGroup(level)} • {level.colorCount}{" "}
                      {tx("renk", "colors")}
                    </Text>
                  </View>
                </View>
                <View style={styles.homeGardenPanelFooter}>
                  <View style={styles.homeGardenPanelLine} />
                  <Flower color={theme.accent} size={18} />
                  <Text style={styles.homeGardenPanelHint}>
                    {tx(
                      "Çiçekleri kendi renklerine ulaştır",
                      "Guide every flower to its color"
                    )}
                  </Text>
                  <View style={styles.homeGardenPanelLine} />
                </View>
              </View>

              <Pressable
                onPress={() => {
                  playEffect(tapPlayer);
                  loadLevel(level.globalIndex);
                }}
                style={({ pressed }) => [
                  styles.homePlayButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <View>
                  <Text style={styles.homePlayOverline}>
                    {tx("DEVAM ET", "CONTINUE")}
                  </Text>
                  <Text style={styles.homePlayText}>
                    {tx("Oyna", "Play")}
                  </Text>
                </View>
                <Text style={styles.homePlayArrow}>→</Text>
              </Pressable>
            </Animated.View>

            <Animated.View
              style={[
                styles.homeSecondaryRow,
                {
                  opacity: homeEntrance.interpolate({
                    inputRange: [0.68, 1],
                    outputRange: [0, 1],
                    extrapolate: "clamp",
                  }),
                  transform: [
                    {
                      translateY: homeEntrance.interpolate({
                        inputRange: [0.68, 1],
                        outputRange: [32, 0],
                        extrapolate: "clamp",
                      }),
                    },
                  ],
                },
              ]}
            >
              <Pressable
                onPress={() => {
                  playEffect(tapPlayer);
                  setSelectedGroupId(progressionGroupForLevel(level).id);
                  setLevelMenuFocusKey(levelKey(level));
                  setRecentlyUnlockedKey(null);
                  setLevelMenu(true);
                }}
                style={({ pressed }) => [
                  styles.homeSecondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Image
                  source={require("./assets/images/app-icon-bloomshift-v2.png")}
                  style={styles.homeSecondaryImage}
                />
                <Text style={styles.homeSecondaryText}>
                  {tx("Bölümler", "Levels")}
                </Text>
                <Text style={styles.homeSecondaryMeta}>
                  {LEVELS.length} {tx("bahçe", "gardens")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  playEffect(tapPlayer);
                  setLevelMenu(false);
                  setShopVisible(true);
                }}
                style={({ pressed }) => [
                  styles.homeSecondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <UiIcon source={UI_ICONS.layerCurrency} size={42} />
                <Text style={styles.homeSecondaryText}>
                  {tx("Mağaza", "Shop")}
                </Text>
                <Text style={styles.homeSecondaryMeta}>
                  {tx("Para Paketleri", "Coin Packs")}
                </Text>
              </Pressable>
            </Animated.View>

            <Animated.View
              accessibilityLabel="Görsen Games"
              style={[
                styles.companyBrand,
                {
                  opacity: homeEntrance.interpolate({
                    inputRange: [0.78, 1],
                    outputRange: [0, 1],
                    extrapolate: "clamp",
                  }),
                },
              ]}
            >
              <Image
                source={require("./assets/images/gorsen-games-logo.png")}
                resizeMode="contain"
                fadeDuration={0}
                style={styles.companyLogo}
              />
              <Text style={styles.companyName}>GÖRSEN GAMES</Text>
            </Animated.View>
          </View>
        </ScrollView>
      ) : screen === "home" ? (
      <View style={styles.homeOpeningSpacer} />
      ) : (
      <ScrollView
        contentContainerStyle={[
          styles.page,
          {
            flexGrow: 1,
            paddingTop: gameTopPadding,
            paddingBottom: compactGameLayout
              ? Math.max(5, insets.bottom + 3)
              : Math.max(18, insets.bottom + 14),
          },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={allowGameScroll}
        bounces={false}
      >
        <View
          style={[
            styles.header,
            compactGameLayout && {
              marginBottom: veryCompactGameLayout ? 4 : 6,
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tx("Ana sayfaya dön", "Return home")}
            disabled={boardBusy}
            onPress={() => {
              playEffect(tapPlayer);
              setScreen("home");
            }}
            style={[
              styles.gameHomeButton,
              compactGameLayout && {
                width: veryCompactGameLayout ? 48 : 52,
                height: veryCompactGameLayout ? 45 : 48,
                borderRadius: 15,
              },
              boardBusy && styles.controlDisabled,
            ]}
          >
            {({ pressed }) => (
                  <AnimatedUiIcon
                    source={UI_ICONS.home}
                    size={compactGameLayout ? 28 : 32}
                    pressed={pressed}
                  />
            )}
          </Pressable>
          <Pressable
            disabled={boardBusy}
            onPress={() => {
              playEffect(tapPlayer);
              openLevelMenu();
            }}
            style={({ pressed }) => [
              styles.headerCopy,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.levelName}>
              {tx("Bölüm", "Level")} {numberInProgressionGroup(level)}
            </Text>
            <Text style={styles.levelMenuShortcut}>
              {tx("BÖLÜMLER", "LEVELS")}
            </Text>
          </Pressable>
          <View style={styles.headerRewards}>
            <View style={styles.rewardPill}>
              <UiIcon source={UI_ICONS.hintCurrency} size={24} />
              <Text style={styles.rewardPillText}>{progress.hintCoins}</Text>
            </View>
            <View style={styles.rewardPill}>
              <UiIcon source={UI_ICONS.layerCurrency} size={24} />
              <Text style={styles.rewardPillText}>{progress.layerCoins}</Text>
            </View>
          </View>
        </View>

        <View
          style={[
            styles.progressTrack,
            { marginBottom: gameSectionGap },
          ]}
        >
          <View
            style={[
              styles.progressFill,
              {
                width: `${(correctCount / board.length) * 100}%`,
                backgroundColor: theme.accent,
              },
            ]}
          />
        </View>

        <TargetPreview
          level={level}
          bottomGap={gameSectionGap}
          compact={compactGameLayout}
        />

        <GameBoard
          key={level.globalIndex}
          level={level}
          board={board}
          direction={direction}
          onRippleCommitted={handleRipple}
          onRippleStarted={() => playEffect(ripplePlayer)}
          onAnimationStateChange={setBoardBusy}
          requestedMove={requestedMove}
        />

        <View
          style={[
            styles.directionCard,
            { marginBottom: gameSectionGap },
          ]}
        >
          <View>
            <Text style={styles.directionLabel}>
              {tx("DALGA YÖNÜ", "WAVE DIRECTION")}
            </Text>
            <Text style={styles.directionMoveCount}>
              {moveCount} {tx("HAMLE", "MOVES")}
            </Text>
          </View>
          <View style={styles.directionButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tx(
                "Dört çiçeği sola döndürme yönünü seç",
                "Select counterclockwise rotation"
              )}
              disabled={boardBusy}
              onPress={() => {
                playEffect(tapPlayer);
                setDirection(-1);
              }}
              style={[
                styles.directionButton,
                compactDirectionStyle,
                direction === -1 && styles.directionButtonSelected,
                boardBusy && styles.controlDisabled,
              ]}
            >
              {({ pressed }) => (
                <>
                  <AnimatedUiIcon
                    source={UI_ICONS.rotateLeft}
                    size={directionIconSize}
                    pressed={pressed}
                    selected={direction === -1}
                  />
                  <Text
                    style={[
                      styles.directionText,
                      direction === -1 &&
                        styles.directionTextSelected,
                    ]}
                  >
                    {tx("Sola", "Left")}
                  </Text>
                </>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tx(
                "Dört çiçeği sağa döndürme yönünü seç",
                "Select clockwise rotation"
              )}
              disabled={boardBusy}
              onPress={() => {
                playEffect(tapPlayer);
                setDirection(1);
              }}
              style={[
                styles.directionButton,
                compactDirectionStyle,
                direction === 1 && styles.directionButtonSelected,
                boardBusy && styles.controlDisabled,
              ]}
            >
              {({ pressed }) => (
                <>
                  <AnimatedUiIcon
                    source={UI_ICONS.rotateRight}
                    size={directionIconSize}
                    pressed={pressed}
                    selected={direction === 1}
                  />
                  <Text
                    style={[
                      styles.directionText,
                      direction === 1 &&
                        styles.directionTextSelected,
                    ]}
                  >
                    {tx("Sağa", "Right")}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tx("Bölümü sıfırla", "Reset level")}
            disabled={boardBusy}
            onPress={() => {
              playEffect(tapPlayer);
              setResetConfirmVisible(true);
            }}
            style={[
              styles.secondaryButton,
              compactControlStyle,
              boardBusy && styles.controlDisabled,
            ]}
          >
            {({ pressed }) => (
              <AnimatedUiIcon
                source={UI_ICONS.reset}
                size={actionIconSize}
                pressed={pressed}
              />
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              progress.freeHints > 0
                ? tx(
                    `İpucu kullan, ${progress.freeHints} ücretsiz ipucu kaldı`,
                    `Use hint, ${progress.freeHints} free hints left`
                  )
                : tx(
                    `İpucu kullan, ${HINT_PRICE} ipucu parası`,
                    `Use hint for ${HINT_PRICE} hint coins`
                  )
            }
            disabled={boardBusy}
            onPress={() => {
              playEffect(tapPlayer);
              showHint();
            }}
            style={[
              styles.hintButton,
              compactControlStyle,
              boardBusy && styles.controlDisabled,
            ]}
          >
            {({ pressed }) => (
              <>
                <View style={styles.hintCostBadge}>
                  <UiIcon
                    source={
                      progress.freeHints > 0
                        ? UI_ICONS.hint
                        : UI_ICONS.hintCurrency
                    }
                    size={17}
                  />
                  <Text style={styles.hintCostBadgeText}>
                    {progress.freeHints > 0
                      ? `×${progress.freeHints}`
                      : HINT_PRICE}
                  </Text>
                </View>
                <AnimatedUiIcon
                  source={UI_ICONS.hint}
                  size={actionIconSize}
                  pressed={pressed}
                />
              </>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tx("Ayarları aç", "Open settings")}
            disabled={boardBusy}
            onPress={() => {
              playEffect(tapPlayer);
              setSettingsVisible(true);
            }}
            style={[
              styles.gameSettingsButton,
              compactControlStyle,
              boardBusy && styles.controlDisabled,
            ]}
          >
            {({ pressed }) => (
              <AnimatedUiIcon
                source={UI_ICONS.settings}
                size={Math.max(32, actionIconSize - 4)}
                pressed={pressed}
              />
            )}
          </Pressable>
        </View>
      </ScrollView>
      )}

      {openingVisible && (
        <OpeningScene
          onRevealHome={() => {
            if (Platform.OS !== "android") setHomeReady(true);
          }}
          onFinished={() => {
            setHomeReady(true);
            setOpeningVisible(false);
            setLanguageWelcomeVisible(!progress.languageChosen);
          }}
          landingTarget={homeLogoTarget}
        />
      )}

      <Modal
        visible={languageWelcomeVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {}}
      >
        <View style={[styles.modalBackdropStrong, modalSafePadding]}>
          <View style={styles.languageWelcomeCard}>
            <View style={styles.languageWelcomeGlow} />
            <Image
              source={require("./assets/images/app-icon-bloomshift-v2.png")}
              style={styles.languageWelcomeLogo}
            />
            <Text style={styles.languageWelcomeOverline}>
              WELCOME • HOŞ GELDİNİZ
            </Text>
            <Text style={styles.languageWelcomeTitle}>
              Choose Your Language
            </Text>
            <Text style={styles.languageWelcomeTurkishTitle}>
              Dilinizi Seçin
            </Text>
            <Text style={styles.languageWelcomeText}>
              You can change this later in Settings.{"\n"}
              Bu seçimi daha sonra Ayarlar bölümünden değiştirebilirsiniz.
            </Text>
            <View style={styles.languageWelcomeOptions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue in English"
                disabled={!progressReady}
                onPress={() => chooseWelcomeLanguage("en")}
                style={({ pressed }) => [
                  styles.languageWelcomeOption,
                  styles.languageWelcomeOptionPrimary,
                  pressed && styles.buttonPressed,
                  !progressReady && styles.controlDisabled,
                ]}
              >
                <Text style={styles.languageWelcomeFlag}>EN</Text>
                <View style={styles.languageWelcomeOptionCopy}>
                  <Text style={styles.languageWelcomeOptionTitleLight}>
                    English
                  </Text>
                  <Text style={styles.languageWelcomeOptionTextLight}>
                    Continue in English
                  </Text>
                </View>
                <Text style={styles.languageWelcomeArrowLight}>→</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Türkçe devam et"
                disabled={!progressReady}
                onPress={() => chooseWelcomeLanguage("tr")}
                style={({ pressed }) => [
                  styles.languageWelcomeOption,
                  pressed && styles.buttonPressed,
                  !progressReady && styles.controlDisabled,
                ]}
              >
                <Text style={styles.languageWelcomeFlag}>TR</Text>
                <View style={styles.languageWelcomeOptionCopy}>
                  <Text style={styles.languageWelcomeOptionTitle}>
                    Türkçe
                  </Text>
                  <Text style={styles.languageWelcomeOptionText}>
                    Türkçe Devam Et
                  </Text>
                </View>
                <Text style={styles.languageWelcomeArrow}>→</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {tutorialVisible && (
        <Modal
          visible
          animationType="none"
          statusBarTranslucent
          onRequestClose={() => {}}
        >
          <FirstLevelTutorial onComplete={completeFirstTutorial} />
        </Modal>
      )}

      <Modal
        visible={hintPromptMode !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setHintPromptMode(null)}
      >
        <View style={[styles.modalBackdropStrong, modalSafePadding]}>
          <View style={styles.hintConfirmCard}>
            <View style={styles.hintConfirmIcon}>
              <UiIcon source={UI_ICONS.hint} size={78} />
            </View>
            <Text style={styles.winOverline}>
              {hintPromptMode === "confirm"
                ? tx("ÜCRETLİ İPUCU", "PAID HINT")
                : tx("İPUCU PARASI", "HINT COINS")}
            </Text>
            <Text style={styles.hintConfirmTitle}>
              {hintPromptMode === "confirm"
                ? tx("İpucu kullanılsın mı?", "Use a hint?")
                : tx("İpucu Parası Yetersiz", "Not Enough Hint Coins")}
            </Text>
            <Text style={styles.hintConfirmText}>
              {hintPromptMode === "confirm"
                ? tx(
                    `Ücretsiz ipuçların bitti. Bu otomatik hamle ${HINT_PRICE} ipucu parası kullanacak. Kabul ediyor musun?`,
                    `Your free hints are gone. This automatic move costs ${HINT_PRICE} hint coins. Continue?`
                  )
                : tx(
                    `Bir ipucu için ${HINT_PRICE} ipucu parası gerekiyor. Şu anda ${progress.hintCoins} paran var.`,
                    `A hint costs ${HINT_PRICE} hint coins. You currently have ${progress.hintCoins}.`
                  )}
            </Text>
            <View style={styles.hintPricePill}>
              <UiIcon source={UI_ICONS.hintCurrency} size={36} />
              <Text style={styles.hintPriceValue}>
                {hintPromptMode === "confirm"
                  ? HINT_PRICE
                  : progress.hintCoins}
              </Text>
              <Text style={styles.hintPriceLabel}>
                {hintPromptMode === "confirm"
                  ? tx("KULLANILACAK", "COST")
                  : tx("BAKİYEN", "BALANCE")}
              </Text>
            </View>
            {hintPromptMode === "confirm" ? (
              <Pressable
                onPress={confirmPaidHint}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {tx("Evet, ipucunu kullan", "Yes, use hint")}
                </Text>
                <Text style={styles.primaryButtonArrow}>→</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => {
                  setHintPromptMode(null);
                  setShopVisible(true);
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {tx("Mağazaya git", "Go to shop")}
                </Text>
                <Text style={styles.primaryButtonArrow}>→</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => setHintPromptMode(null)}
              style={styles.keepPlaying}
            >
              <Text style={styles.keepPlayingText}>
                {tx("Vazgeç", "Cancel")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={resetConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setResetConfirmVisible(false)}
      >
        <View style={[styles.modalBackdropStrong, modalSafePadding]}>
          <View style={styles.hintConfirmCard}>
            <View style={styles.hintConfirmIcon}>
              <UiIcon source={UI_ICONS.reset} size={78} />
            </View>
            <Text style={styles.winOverline}>
              {tx("BÖLÜMÜ SIFIRLA", "RESET LEVEL")}
            </Text>
            <Text style={styles.hintConfirmTitle}>
              {tx(
                "Baştan başlamak istiyor musun?",
                "Start this level over?"
              )}
            </Text>
            <Text style={styles.hintConfirmText}>
              {tx(
                "Bu bölümde yaptığın hamleler silinecek ve çiçekler başlangıç düzenine dönecek.",
                "Your moves in this level will be cleared and the flowers will return to their starting positions."
              )}
            </Text>
            <Pressable
              onPress={() => {
                setResetConfirmVisible(false);
                resetLevel();
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {tx("Evet, sıfırla", "Yes, reset")}
              </Text>
              <Text style={styles.primaryButtonArrow}>↺</Text>
            </Pressable>
            <Pressable
              onPress={() => setResetConfirmVisible(false)}
              style={styles.keepPlaying}
            >
              <Text style={styles.keepPlayingText}>
                {tx("Vazgeç", "Cancel")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={won}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={[styles.modalBackdrop, modalSafePadding]}>
          <View style={styles.winCard}>
            <ScrollView
              style={styles.winCardScroll}
              contentContainerStyle={styles.winCardScrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
            <Text style={styles.winBotanicalCorner}>❧</Text>
            <Text style={styles.winOverline}>
              {tx("BÖLÜM TAMAMLANDI", "LEVEL COMPLETE")}
            </Text>
            <View style={styles.winStarPanel}>
              <Text style={styles.winStarPanelLabel}>
                {winReward.stars === 3
                  ? tx("Kusursuz Bahçe", "Perfect Garden")
                  : winReward.stars === 2
                    ? tx("Güzel Bahçe", "Great Garden")
                    : tx("Bahçe Tamamlandı", "Garden Cleared")}
              </Text>
              <StarRewardDisplay
                stars={winReward.stars}
                compact={compactGameLayout}
                animated={won}
              />
              <View style={styles.winStarPanelDivider} />
              <View style={styles.winStarPanelStats}>
                <Text style={styles.winStarPanelStat}>
                  {winReward.stars}/3 {tx("Yıldız", "Stars")}
                </Text>
                <Text style={styles.winStarPanelDot}>•</Text>
                <Text style={styles.winStarPanelStat}>
                  {moveCount} {tx("Hamle", "Moves")}
                </Text>
              </View>
            </View>
            {won && <VictoryBouquet />}
            <Text style={styles.winText}>
              {isWarmupLevel(level)
                ? tx(
                    "Harika gidiyorsun. Isınma Turu bölümleri oyunu öğrenmen için ödülsüzdür.",
                    "You're doing great. Warm-up levels are reward-free and help you learn the game."
                  )
                : tx(
                    "Ödülünü al ve sıradaki bahçeye devam et.",
                    "Collect your reward and continue to the next garden."
                  )}
            </Text>
            {isWarmupLevel(level) ? (
              <View style={styles.winRewardCard}>
                <Text style={styles.winRewardTitle}>
                  {tx(
                    "Bu öğretici bölümde para ödülü yok.",
                    "There is no coin reward in this tutorial level."
                  )}
                </Text>
              </View>
            ) : winReward.firstCompletion ? (
              <View style={styles.animatedRewardsRow}>
                <AnimatedRewardAmount
                  amount={
                    winReward.hintCoins *
                    (winReward.doubled ? 2 : 1)
                  }
                  currentBalance={winReward.hintBalanceBefore}
                  iconSource={UI_ICONS.hintCurrency}
                  label={tx("İPUCU PARASI", "HINT COINS")}
                  color="#8B6FD6"
                />
                <AnimatedRewardAmount
                  amount={
                    winReward.layerCoins *
                    (winReward.doubled ? 2 : 1)
                  }
                  currentBalance={winReward.layerBalanceBefore}
                  iconSource={UI_ICONS.layerCurrency}
                  label={tx("KATMAN PARASI", "LAYER COINS")}
                  color="#D59A28"
                />
              </View>
            ) : (
              <View style={styles.winRewardCard}>
                <Text style={styles.winRewardTitle}>
                  {tx(
                    "Bu bölümün ödülü daha önce alındı.",
                    "This level's reward has already been collected."
                  )}
                </Text>
              </View>
            )}
            {!isWarmupLevel(level) && !progress.adsRemoved && (
              <Pressable
                disabled={
                  !winReward.firstCompletion ||
                  winReward.doubled ||
                  rewardedAdState === "showing"
                }
                onPress={showRewardedAd}
                style={({ pressed }) => [
                  styles.doubleRewardButton,
                  (!winReward.firstCompletion ||
                    winReward.doubled ||
                    rewardedAdState === "showing") &&
                    styles.controlDisabled,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.doubleRewardIcon}>▶</Text>
                <View style={styles.doubleRewardCopy}>
                  <Text style={styles.doubleRewardTitle}>
                    {winReward.doubled
                      ? tx("2x ödül alındı", "2x reward collected")
                      : tx("Ödülü 2x yap", "Double the reward")}
                  </Text>
                  <Text style={styles.doubleRewardMeta}>
                    {winReward.doubled
                      ? tx(
                          "Paralar hesabına eklendi",
                          "Coins added to your balance"
                        )
                      : rewardedAdState === "ready"
                        ? tx(
                            "Videoyu izle ve ödülünü ikiye katla",
                            "Watch a video to double your reward"
                          )
                        : rewardedAdState === "showing"
                          ? tx("Reklam oynatılıyor...", "Ad is playing...")
                          : rewardedAdState === "error"
                            ? tx(
                                "Reklam kullanılamıyor, tekrar dene",
                                "Ad unavailable, tap to retry"
                              )
                      : tx(
                          "Reklam hazırlanıyor...",
                          "Ad is preparing..."
                        )}
                  </Text>
                </View>
                <Text style={styles.doubleRewardBadge}>2x</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                playEffect(tapPlayer);
                continueAfterCompletion();
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {isWarmupLevel(level)
                  ? tx("Devam", "Continue")
                  : winReward.firstCompletion && !winReward.doubled
                  ? tx("Normal ödülü al", "Collect normal reward")
                  : tx("Devam", "Continue")}
              </Text>
              <Text style={styles.primaryButtonArrow}>→</Text>
            </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={warmupCelebrationVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {}}
      >
        <View style={[styles.modalBackdropStrong, modalSafePadding]}>
          <View style={styles.unlockCard}>
            <Text style={styles.winBotanicalCorner}>❧</Text>
            <Text style={styles.winOverline}>
              {tx("TEBRİKLER", "CONGRATULATIONS")}
            </Text>
            <VictoryBouquet />
            <Text style={styles.unlockTitle}>
              {tx(
                "Isınma Turu'nu tamamladın!",
                "You completed the Warm-up Tour!"
              )}
            </Text>
            <Text style={styles.unlockText}>
              {tx(
                "Artık dalgaları kullanmaya hazırsın. Sırada 3×3 Sabah Bahçesi'nin ilk bölümü var.",
                "You are ready to guide the waves. The first level of the 3×3 Morning Garden is next."
              )}
            </Text>
            <Text style={styles.layerCelebrationDots}>●  ●  ●</Text>
            <Pressable
              onPress={continueAfterWarmupCelebration}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: LAYER_THEMES[3].accent },
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {tx("3×3 bahçesine geç", "Continue to the 3×3 garden")}
              </Text>
              <Text style={styles.primaryButtonArrow}>→</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {levelMenu && (
      <Modal
        visible
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          if (layerEntry) return;
          if (layerCelebration) {
            beginLayerEntry(layerCelebration);
            return;
          }
          if (unlockCandidate) {
            setUnlockCandidate(null);
            return;
          }
          if (blockedGroupCandidate) {
            setBlockedGroupCandidate(null);
            return;
          }
          setPendingAutoLevel(null);
          setRecentlyCompletedKey(null);
          setLevelMenu(false);
        }}
      >
        <ImageBackground
          source={levelModeTheme.image}
          resizeMode="cover"
          style={[
            styles.levelScreen,
            { backgroundColor: levelModeTheme.background },
          ]}
          imageStyle={[
            styles.levelScreenBackground,
            { opacity: levelModeTheme.imageOpacity },
          ]}
        >
          <SafeAreaView
            edges={["top", "left", "right"]}
            style={styles.levelScreenSafe}
          >
            <View
              style={[
                styles.levelScreenTop,
                {
                  minHeight: compactLevelMenu ? 58 : 66,
                  paddingTop: compactLevelMenu ? 8 : 12,
                  paddingHorizontal: screenWidth < 360 ? 10 : 16,
                },
              ]}
            >
              <Pressable
                onPress={() => {
                  setPendingAutoLevel(null);
                  setRecentlyCompletedKey(null);
                  setLevelMenu(false);
                  setScreen("home");
                }}
                style={({ pressed }) => [
                  styles.levelHomeButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <UiIcon
                  source={UI_ICONS.home}
                  size={screenWidth < 360 ? 39 : 44}
                />
              </Pressable>
              <View
                style={[
                  styles.levelScreenWallet,
                  screenWidth < 360 && { gap: 4 },
                ]}
              >
                <View
                  style={[
                    styles.levelScreenCurrency,
                    screenWidth < 360 && {
                      minWidth: 66,
                      height: 37,
                      paddingRight: 8,
                      gap: 4,
                    },
                  ]}
                >
                  <UiIcon
                    source={UI_ICONS.hintCurrency}
                    size={screenWidth < 360 ? 27 : 31}
                  />
                  <Text
                    style={[
                      styles.levelScreenCurrencyText,
                      screenWidth < 360 && { fontSize: 14 },
                    ]}
                  >
                    {progress.hintCoins}
                  </Text>
                </View>
                <View
                  style={[
                    styles.levelScreenCurrency,
                    screenWidth < 360 && {
                      minWidth: 66,
                      height: 37,
                      paddingRight: 8,
                      gap: 4,
                    },
                  ]}
                >
                  <UiIcon
                    source={UI_ICONS.layerCurrency}
                    size={screenWidth < 360 ? 27 : 31}
                  />
                  <Text
                    style={[
                      styles.levelScreenCurrencyText,
                      screenWidth < 360 && { fontSize: 14 },
                    ]}
                  >
                    {progress.layerCoins}
                  </Text>
                </View>
              </View>
            </View>
            <View
              style={[
                styles.levelTitleDecor,
                compactLevelMenu && { height: 42 },
              ]}
            >
              <Text
                style={[
                  styles.levelTitleFlower,
                  { color: levelModeTheme.accent },
                ]}
              >
                ❀
              </Text>
              <Text
                style={[
                  styles.levelScreenTitle,
                  compactLevelMenu && { fontSize: 30, lineHeight: 36 },
                  { color: levelModeTheme.primary },
                ]}
              >
                {tx("Bölümler", "Levels")}
              </Text>
              <Text
                style={[
                  styles.levelTitleFlower,
                  { color: levelModeTheme.accent },
                ]}
              >
                ❀
              </Text>
            </View>

            <View
              style={[
                styles.modePickerWrap,
                compactLevelMenu && {
                  height: 38,
                  marginBottom: 5,
                },
                {
                  backgroundColor: levelModeTheme.surface,
                  borderColor: levelModeTheme.border,
                },
              ]}
            >
              <Text style={styles.modePickerLabel}>
                {tx("MOD", "MODE")}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: modePickerOpen }}
                onPress={() => setModePickerOpen((open) => !open)}
                style={({ pressed }) => [
                  styles.modePickerButton,
                  { backgroundColor: levelModeTheme.primary },
                  pressed && styles.buttonPressed,
                ]}
              >
                <View
                  style={[
                    styles.modePickerDot,
                    selectedGroup.difficulty === "medium" &&
                      styles.modePickerDotMedium,
                    selectedGroup.difficulty === "hard" &&
                      styles.modePickerDotHard,
                  ]}
                />
                <Text style={styles.modePickerButtonText}>
                  {language === "en"
                    ? EN_DIFFICULTY_LABELS[selectedGroup.difficulty]
                    : DIFFICULTY_LABELS[selectedGroup.difficulty]}
                </Text>
                <Text style={styles.modePickerChevron}>
                  {modePickerOpen ? "⌃" : "⌄"}
                </Text>
              </Pressable>
              {modePickerOpen && (
                <View style={styles.modePickerMenu}>
                  {(["easy", "medium", "hard"] as const).map(
                    (difficulty) => (
                      <Pressable
                        key={difficulty}
                        onPress={() => {
                          const groups = PROGRESSION_GROUPS.filter(
                            (group) => group.difficulty === difficulty
                          );
                          const firstUnlocked =
                            groups.find((group) => isGroupUnlocked(group)) ??
                            groups[0];
                          setModePickerOpen(false);
                          tryOpenGroup(firstUnlocked);
                          if (progress.hapticsEnabled) {
                            void Haptics.selectionAsync().catch(() => {});
                          }
                        }}
                        style={[
                          styles.modePickerOption,
                          selectedGroup.difficulty === difficulty &&
                            [
                              styles.modePickerOptionSelected,
                              {
                                backgroundColor:
                                  levelModeTheme.selectedSurface,
                              },
                            ],
                        ]}
                      >
                        <Text
                          style={[
                            styles.modePickerOptionText,
                            selectedGroup.difficulty === difficulty &&
                              [
                                styles.modePickerOptionTextSelected,
                                { color: levelModeTheme.primary },
                              ],
                          ]}
                        >
                          {language === "en"
                            ? EN_DIFFICULTY_LABELS[difficulty]
                            : DIFFICULTY_LABELS[difficulty]}
                        </Text>
                      </Pressable>
                    )
                  )}
                </View>
              )}
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={[
                styles.layerGardenScroll,
                compactLevelMenu && { marginBottom: 4 },
              ]}
              contentContainerStyle={styles.layerGardenCards}
            >
              {PROGRESSION_GROUPS.filter(
                (group) => group.difficulty === selectedGroup.difficulty
              ).map((group) => {
                const unlocked = isGroupUnlocked(group);
                const unlockable = canUnlockGroup(group);
                const selected = selectedGroupId === group.id;
                return (
                  <Pressable
                    key={group.id}
                    onPress={() => tryOpenGroup(group)}
                    style={({ pressed }) => [
                      styles.layerGardenCard,
                      compactLevelMenu && { width: 86, height: 68 },
                      {
                        backgroundColor: levelModeTheme.surface,
                        borderColor: levelModeTheme.border,
                      },
                      selected && [
                        styles.layerGardenCardSelected,
                        {
                          backgroundColor:
                            levelModeTheme.selectedSurface,
                          borderColor: levelModeTheme.primary,
                        },
                      ],
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Flower
                      color={
                        selected
                          ? levelModeTheme.accent
                          : unlocked
                            ? levelModeTheme.unlocked
                            : "#B5B0A4"
                      }
                      size={compactLevelMenu ? 27 : 32}
                    />
                    <Text
                      style={[
                        styles.layerGardenSize,
                        isWarmupGroup(group) && { fontSize: 11 },
                      ]}
                    >
                      {isWarmupGroup(group)
                        ? tx("ISINMA TURU", "WARM-UP")
                        : `${group.cols}×${group.rows}`}
                    </Text>
                    <View style={styles.layerGardenMeta}>
                      {unlocked ? (
                        <>
                          <Text style={styles.layerGardenCheck}>✓</Text>
                          <Text style={styles.layerGardenMetaText}>
                            {
                              group.levels.filter((item) =>
                                completed.has(levelKey(item))
                              ).length
                            }
                            /{group.levels.length}
                          </Text>
                        </>
                      ) : unlockable ? (
                        <>
                          <UiIcon
                            source={UI_ICONS.layerCurrency}
                            size={20}
                          />
                          <Text style={styles.layerGardenCost}>
                            {group.unlockCost}
                          </Text>
                        </>
                      ) : (
                        <Text style={styles.layerGardenLocked}>🔒</Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            <FlatList
              ref={levelListRef}
              key={selectedGroupId}
              data={selectedLevels}
              numColumns={5}
              style={styles.levelScroll}
              contentContainerStyle={styles.levelScrollContent}
              columnWrapperStyle={[
                styles.levelGridRow,
                selectedLevels.length <= 5 && styles.levelGridRowShort,
              ]}
              showsVerticalScrollIndicator={false}
              initialNumToRender={20}
              maxToRenderPerBatch={15}
              updateCellsBatchingPeriod={24}
              windowSize={5}
              keyExtractor={levelKey}
              renderItem={({ item }) => {
                const itemCompleted = completed.has(levelKey(item));
                const itemResult = progress.results[levelKey(item)];
                const itemUnlocked = isLevelUnlocked(item);
                const firstPlayable =
                  selectedLevels.find(
                    (candidate) =>
                      isLevelUnlocked(candidate) &&
                      !completed.has(levelKey(candidate))
                  ) ?? selectedLevels[0];
                return (
                  <LevelGridTile
                    item={item}
                    current={
                      itemUnlocked &&
                      levelKey(item) ===
                        (recentlyUnlockedKey ??
                          levelMenuFocusKey ??
                          levelKey(firstPlayable))
                    }
                    completed={itemCompleted}
                    locked={!itemUnlocked}
                    newlyUnlocked={recentlyUnlockedKey === levelKey(item)}
                    justCompleted={
                      recentlyCompletedKey === levelKey(item)
                    }
                    stars={itemResult?.stars ?? 1}
                    accent={levelModeTheme.primary}
                    onPress={() => {
                      playEffect(tapPlayer);
                      setRecentlyUnlockedKey(null);
                      loadLevel(item.globalIndex);
                    }}
                  />
                );
              }}
              ListHeaderComponent={
                <View
                  style={[
                    styles.levelProgressCard,
                    compactLevelMenu && {
                      minHeight: 52,
                      marginBottom: 6,
                    },
                    {
                      backgroundColor: levelModeTheme.surface,
                      borderColor: levelModeTheme.border,
                    },
                  ]}
                >
                  <View style={styles.levelProgressIcon}>
                    <Flower
                      color={levelModeTheme.accent}
                      size={38}
                    />
                  </View>
                  <View style={styles.levelProgressCopy}>
                    <Text
                      style={[
                        styles.levelProgressTitle,
                        { color: levelModeTheme.primary },
                      ]}
                    >
                      {isWarmupGroup(selectedGroup)
                        ? tx("Isınma Turu", "Warm-up Tour")
                        : `${selectedGroup.cols}×${selectedGroup.rows} ${
                            language === "en"
                              ? EN_DIFFICULTY_LABELS[selectedGroup.difficulty]
                              : DIFFICULTY_LABELS[selectedGroup.difficulty]
                          }`}{" "}
                      •{" "}
                      {
                        selectedLevels.filter((item) =>
                          completed.has(levelKey(item))
                        ).length
                      }
                      /{selectedLevels.length} {tx("tamamlandı", "completed")}
                    </Text>
                    <View style={styles.levelProgressTrack}>
                      <View
                        style={[
                          styles.levelProgressFill,
                          {
                            width: `${
                              (selectedLevels.filter((item) =>
                                completed.has(levelKey(item))
                              ).length /
                                selectedLevels.length) *
                              100
                            }%`,
                            backgroundColor: levelModeTheme.progress,
                          },
                        ]}
                      />
                    </View>
                  </View>
                </View>
              }
              ListFooterComponent={
                <Text style={styles.levelMenuNote}>
                  {tx("Toplam", "Total")} {LEVELS.length}{" "}
                  {tx("renkli bahçe", "colorful gardens")}
                </Text>
              }
            />
            <View
              style={[
                styles.levelBottomBar,
                {
                  height: 68 + insets.bottom,
                  paddingBottom: insets.bottom,
                  backgroundColor: levelModeTheme.bottomBar,
                },
              ]}
            >
              <Pressable
                onPress={() => {
                  setPendingAutoLevel(null);
                  setRecentlyCompletedKey(null);
                  setLevelMenu(false);
                  setScreen("home");
                }}
                style={({ pressed }) => [
                  styles.levelBottomAction,
                  pressed && styles.buttonPressed,
                ]}
              >
                <UiIcon source={UI_ICONS.home} size={38} />
                <Text style={styles.levelBottomText}>
                  {tx("ANA SAYFA", "HOME")}
                </Text>
              </Pressable>
              <View style={styles.levelBottomLogoWrap}>
                <Image
                  source={require("./assets/images/app-icon-bloomshift-v2.png")}
                  style={styles.levelBottomLogo}
                />
              </View>
              <Pressable
                onPress={() => {
                  setLevelMenu(false);
                  setShopVisible(true);
                }}
                style={({ pressed }) => [
                  styles.levelBottomAction,
                  pressed && styles.buttonPressed,
                ]}
              >
                <UiIcon source={UI_ICONS.layerCurrency} size={38} />
                <Text style={styles.levelBottomText}>
                  {tx("MAĞAZA", "SHOP")}
                </Text>
              </Pressable>
            </View>

            {blockedGroupCandidate && (
              <View
                style={[
                  styles.levelInlineOverlay,
                  {
                    paddingTop: 12,
                    paddingBottom: Math.max(20, insets.bottom + 12),
                  },
                ]}
              >
                <View style={styles.unlockCard}>
                  <View style={styles.hintConfirmIcon}>
                    <UiIcon source={UI_ICONS.layerCurrency} size={72} />
                  </View>
                  <Text style={styles.winOverline}>
                    {tx("KATMAN KİLİTLİ", "GARDEN LOCKED")}
                  </Text>
                  <Text style={styles.unlockTitle}>
                    {tx("Sırayla ilerlemelisin", "Follow the garden path")}
                  </Text>
                  <Text style={styles.unlockText}>
                    {(() => {
                      const previous =
                        previousGroupFor(blockedGroupCandidate);
                      if (!previous) {
                        return tx(
                          "Bu katman henüz açılamıyor.",
                          "This garden cannot be opened yet."
                        );
                      }
                      const previousDifficulty =
                        language === "en"
                          ? EN_DIFFICULTY_LABELS[previous.difficulty]
                          : DIFFICULTY_LABELS[previous.difficulty];
                      return tx(
                        `Önce ${previous.cols}×${previous.rows} ${previousDifficulty} katmanını açmalısın.`,
                        `Unlock the ${previous.cols}×${previous.rows} ${previousDifficulty} garden first.`
                      );
                    })()}
                  </Text>
                  <Pressable
                    onPress={() => setBlockedGroupCandidate(null)}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>
                      {tx("Tamam", "OK")}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            {unlockCandidate && (
              <View
                style={[
                  styles.levelInlineOverlay,
                  {
                    paddingTop: 12,
                    paddingBottom: Math.max(20, insets.bottom + 12),
                  },
                ]}
              >
                <View style={styles.unlockCard}>
                  <ImageBackground
                    source={LAYER_THEMES[unlockCandidate.size].image}
                    resizeMode="cover"
                    style={styles.unlockGardenHero}
                    imageStyle={styles.unlockGardenHeroImage}
                  >
                    <View style={styles.unlockGardenHeroShade}>
                      <View style={styles.unlockGardenFlower}>
                        <Flower
                          color={LAYER_THEMES[unlockCandidate.size].accent}
                          size={70}
                        />
                      </View>
                      <View style={styles.unlockGardenBadge}>
                        <UiIcon
                          source={UI_ICONS.layerCurrency}
                          size={25}
                        />
                        <Text style={styles.unlockGardenBadgeText}>
                          {tx("YENİ KATMAN", "NEW GARDEN")}
                        </Text>
                      </View>
                    </View>
                  </ImageBackground>
                  <Text style={styles.winOverline}>
                    {tx("KATMANI AÇ?", "UNLOCK GARDEN?")}
                  </Text>
                  <Text style={styles.unlockTitle}>
                    {unlockCandidate.cols}×{unlockCandidate.rows}{" "}
                    {language === "en"
                      ? EN_DIFFICULTY_LABELS[unlockCandidate.difficulty]
                      : DIFFICULTY_LABELS[unlockCandidate.difficulty]}
                  </Text>
                  <Text style={styles.unlockText}>
                    {tx(
                      `Yeni katman ${unlockCandidate.unlockCost} katman parası karşılığında açılacak. Onayladığında açılış efektinden sonra ilk bölüme otomatik gireceksin.`,
                      `This new garden costs ${unlockCandidate.unlockCost} layer coins. Once confirmed, it will open and its first level will start automatically.`
                    )}
                  </Text>
                  <View style={styles.unlockBalanceCard}>
                    <View style={styles.unlockBalanceColumn}>
                      <Text style={styles.unlockBalanceLabel}>
                        {tx("GEREKEN", "COST")}
                      </Text>
                      <View style={styles.unlockBalanceValueRow}>
                        <UiIcon
                          source={UI_ICONS.layerCurrency}
                          size={28}
                        />
                        <Text style={styles.unlockCostValue}>
                          {unlockCandidate.unlockCost}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.unlockBalanceDivider} />
                    <View style={styles.unlockBalanceColumn}>
                      <Text style={styles.unlockBalanceLabel}>
                        {tx("BAKİYEN", "BALANCE")}
                      </Text>
                      <View style={styles.unlockBalanceValueRow}>
                        <UiIcon
                          source={UI_ICONS.layerCurrency}
                          size={28}
                        />
                        <Text style={styles.unlockBalanceOwned}>
                          {progress.layerCoins}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {progress.layerCoins < unlockCandidate.unlockCost && (
                    <View style={styles.unlockShortfall}>
                      <Text style={styles.unlockShortfallText}>
                        {tx(
                          `${unlockCandidate.unlockCost - progress.layerCoins} katman parası eksik`,
                          `${unlockCandidate.unlockCost - progress.layerCoins} more layer coins needed`
                        )}
                      </Text>
                    </View>
                  )}
                  <Pressable
                    onPress={() => {
                      if (
                        progress.layerCoins >= unlockCandidate.unlockCost
                      ) {
                        unlockGroup(unlockCandidate);
                        return;
                      }
                      setUnlockCandidate(null);
                      setLevelMenu(false);
                      setShopVisible(true);
                    }}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      progress.layerCoins < unlockCandidate.unlockCost &&
                        styles.unlockStorePrimary,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>
                      {progress.layerCoins < unlockCandidate.unlockCost
                        ? tx(
                            "Mağazadan katman parası al",
                            "Get layer coins from shop"
                          )
                        : tx("Evet, katmanı aç", "Yes, unlock")}
                    </Text>
                    <Text style={styles.primaryButtonArrow}>→</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setUnlockCandidate(null)}
                    style={styles.unlockShopButton}
                  >
                    <Text style={styles.unlockShopText}>
                      {tx("Hayır, şimdi değil", "Not now")}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            {layerCelebration && (
              <View
                style={[
                  styles.levelInlineOverlay,
                  {
                    paddingTop: 12,
                    paddingBottom: Math.max(20, insets.bottom + 12),
                  },
                ]}
              >
                <View style={styles.unlockCard}>
                  <View style={styles.celebrationFlower}>
                    <Flower
                      color={LAYER_THEMES[layerCelebration.size].accent}
                      size={92}
                    />
                  </View>
                  <Text style={styles.winOverline}>
                    {tx("LÜTFEN BEKLE", "PLEASE WAIT")}
                  </Text>
                  <Text style={styles.unlockTitle}>
                    {layerCelebration.cols}×{layerCelebration.rows}{" "}
                    {language === "en"
                      ? EN_DIFFICULTY_LABELS[layerCelebration.difficulty]
                      : DIFFICULTY_LABELS[layerCelebration.difficulty]}{" "}
                    {tx("katmanı açılıyor...", "garden is opening...")}
                  </Text>
                  <Text style={styles.unlockText}>
                    {tx(
                      "Yeni bahçe hazırlanıyor. Ardından ilk bölüme gireceksin.",
                      "Your new garden is being prepared. Its first level will open next."
                    )}
                  </Text>
                  <Text style={styles.layerCelebrationDots}>●  ●  ●</Text>
                  <Pressable
                    onPress={() => beginLayerEntry(layerCelebration)}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      {
                        backgroundColor:
                          LAYER_THEMES[layerCelebration.size].accent,
                      },
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>
                      {tx("Hemen devam et", "Continue now")}
                    </Text>
                    <Text style={styles.primaryButtonArrow}>→</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {layerEntry && (
              <LayerEntryScene
                group={layerEntry}
                onFinished={() => finishLayerEntry(layerEntry)}
              />
            )}

          </SafeAreaView>
        </ImageBackground>
      </Modal>
      )}

      {shopVisible && (
      <Modal
        visible
        transparent
        animationType="slide"
        onRequestClose={closeShop}
      >
        <View style={[styles.modalBackdrop, modalSafePadding]}>
          <View style={styles.infoCard}>
            <View style={styles.levelCardHeader}>
              <View>
                <Text style={styles.winOverline}>
                  {tx("MAĞAZA", "SHOP")}
                </Text>
                <Text style={styles.levelCardTitle}>
                  {tx("Bahçe mağazası", "Garden shop")}
                </Text>
              </View>
              <Pressable
                onPress={closeShop}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>×</Text>
              </Pressable>
            </View>
            <View style={styles.shopBalances}>
              <View style={styles.shopBalance}>
                <UiIcon source={UI_ICONS.hintCurrency} size={30} />
                <Text style={styles.shopBalanceValue}>
                  {progress.hintCoins}
                </Text>
                <Text style={styles.shopBalanceLabel}>
                  {tx("ipucu parası", "hint coins")}
                </Text>
              </View>
              <View style={styles.shopBalance}>
                <UiIcon source={UI_ICONS.layerCurrency} size={30} />
                <Text style={styles.shopBalanceValue}>
                  {progress.layerCoins}
                </Text>
                <Text style={styles.shopBalanceLabel}>
                  {tx("katman parası", "layer coins")}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tx(
                "Satın alma geçmişini aç",
                "Open purchase history"
              )}
              onPress={() => setPurchaseHistoryVisible(true)}
              style={({ pressed }) => [
                styles.purchaseHistoryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <View style={styles.purchaseHistoryIcon}>
                <Text style={styles.purchaseHistoryIconText}>↶</Text>
              </View>
              <View style={styles.purchaseHistoryButtonCopy}>
                <Text style={styles.purchaseHistoryButtonTitle}>
                  {tx("Satın Alma Geçmişi", "Purchase History")}
                </Text>
                <Text style={styles.purchaseHistoryButtonMeta}>
                  {progress.purchaseHistory.length > 0
                    ? tx(
                        `${progress.purchaseHistory.length} tamamlanan satın alma`,
                        `${progress.purchaseHistory.length} completed purchases`
                      )
                    : tx(
                        "Henüz tamamlanan satın alma yok",
                        "No completed purchases yet"
                      )}
                </Text>
              </View>
              <Text style={styles.purchaseHistoryChevron}>›</Text>
            </Pressable>
            <ScrollView
              style={styles.shopScroll}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.shopSectionTitle}>
                ◇ {tx("REKLAMSIZ PAKET", "AD-FREE PACK")}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  progress.adsRemoved
                    ? tx("Reklamsız paket aktif", "Ad-free pack active")
                    : tx("Reklamları kaldır paketini satın al", "Buy Remove Ads")
                }
                disabled={progress.adsRemoved || Boolean(iapProcessingProductId)}
                onPress={() => void requestStorePurchase(REMOVE_ADS_PRODUCT_ID)}
                style={({ pressed }) => [
                  styles.shopAdFreeItem,
                  progress.adsRemoved && styles.shopAdFreeItemActive,
                  pressed && styles.buttonPressed,
                ]}
              >
                <View style={styles.shopAdFreeIconWrap}>
                  <AdFreeIcon size={46} active={progress.adsRemoved} />
                </View>
                <View style={styles.shopItemCopy}>
                  <View style={styles.shopItemTitleRow}>
                    <Text style={styles.shopAdFreeTitle}>
                      {tx("Reklamları Kaldır", "Remove Ads")}
                    </Text>
                    <Text style={styles.shopAdFreeBadge}>
                      {progress.adsRemoved
                        ? tx("AKTİF", "ACTIVE")
                        : tx("KALICI", "PERMANENT")}
                    </Text>
                  </View>
                  <Text style={styles.shopAdFreeDescription}>
                    {tx(
                      "Geçiş ve ödüllü reklamları kalıcı olarak kapatır.",
                      "Permanently disables interstitial and rewarded ads."
                    )}
                  </Text>
                </View>
                <Text style={styles.shopAdFreePrice}>
                  {progress.adsRemoved
                    ? tx("ALINDI", "OWNED")
                    : iapProcessingProductId === REMOVE_ADS_PRODUCT_ID
                      ? "…"
                      : storePrice(REMOVE_ADS_PRODUCT_ID)}
                </Text>
              </Pressable>
              <View style={styles.economyGuide}>
                <Text style={styles.economyGuideTitle}>
                  {tx("OYUN EKONOMİSİ", "GAME ECONOMY")}
                </Text>
                <Text style={styles.economyGuideCaption}>
                  {tx(
                    "Her bölümü ilk kez geçtiğinde kazanırsın",
                    "Earned the first time you complete each level"
                  )}
                </Text>
                <View style={styles.economyRewardRow}>
                  {[
                    {
                      label: tx("KOLAY", "EASY"),
                      amount: 2,
                      color: "#3C916E",
                    },
                    {
                      label: tx("ORTA", "MEDIUM"),
                      amount: 3,
                      color: "#B77A1D",
                    },
                    {
                      label: tx("ZOR", "HARD"),
                      amount: 4,
                      color: "#6E5899",
                    },
                  ].map((reward) => (
                    <View
                      key={reward.label}
                      style={[
                        styles.economyRewardChip,
                        { borderColor: `${reward.color}55` },
                      ]}
                    >
                      <Text
                        style={[
                          styles.economyRewardLabel,
                          { color: reward.color },
                        ]}
                      >
                        {reward.label}
                      </Text>
                      <View style={styles.economyRewardValues}>
                        <UiIcon
                          source={UI_ICONS.hintCurrency}
                          size={19}
                        />
                        <Text style={styles.economyRewardAmount}>
                          +{reward.amount}
                        </Text>
                        <UiIcon
                          source={UI_ICONS.layerCurrency}
                          size={19}
                        />
                        <Text style={styles.economyRewardAmount}>
                          +{reward.amount}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
                <View style={styles.economyCostList}>
                  <View style={styles.economyCostRow}>
                    <UiIcon source={UI_ICONS.hint} size={27} />
                    <Text style={styles.economyCostText}>
                      {tx("1 otomatik ipucu", "1 automatic hint")}
                    </Text>
                    <Text style={styles.economyCostValue}>
                      {HINT_PRICE}
                    </Text>
                    <UiIcon
                      source={UI_ICONS.hintCurrency}
                      size={24}
                    />
                  </View>
                  <View style={styles.economyCostRow}>
                    <UiIcon
                      source={UI_ICONS.layerCurrency}
                      size={27}
                    />
                    <Text style={styles.economyCostText}>
                      {tx("Yeni katmanlar", "New gardens")}
                    </Text>
                    <Text style={styles.economyCostValue}>
                      40
                    </Text>
                  </View>
                  <View style={styles.economyCostRow}>
                    <Flower color="#D59A28" size={25} />
                    <Text style={styles.economyCostText}>
                      {tx("Orta modu aç", "Unlock Medium")}
                    </Text>
                    <Text style={styles.economyCostValue}>40</Text>
                    <UiIcon
                      source={UI_ICONS.layerCurrency}
                      size={24}
                    />
                  </View>
                  <View style={styles.economyCostRow}>
                    <Flower color="#756A9B" size={25} />
                    <Text style={styles.economyCostText}>
                      {tx("Zor modu aç", "Unlock Hard")}
                    </Text>
                    <Text style={styles.economyCostValue}>40</Text>
                    <UiIcon
                      source={UI_ICONS.layerCurrency}
                      size={24}
                    />
                  </View>
                </View>
              </View>
              <Text style={styles.shopSectionTitle}>
                ✦ {tx("İPUCU PARASI", "HINT COINS")}
              </Text>
              {[
                {
                  id: "hint_coins_60",
                  amount: 60,
                  price: storePrice("hint_coins_60"),
                  label: tx("Filiz Paketi", "Sprout Pack"),
                  badge: null,
                },
                {
                  id: "hint_coins_200",
                  amount: 200,
                  price: storePrice("hint_coins_200"),
                  label: tx("Çiçek Paketi", "Flower Pack"),
                  badge: tx("POPÜLER", "POPULAR"),
                },
                {
                  id: "hint_coins_500",
                  amount: 500,
                  price: storePrice("hint_coins_500"),
                  label: tx("Bahçe Paketi", "Garden Pack"),
                  badge: tx("EN İYİ DEĞER", "BEST VALUE"),
                },
              ].map((pack) => (
                <Pressable
                  key={pack.id}
                  disabled={Boolean(iapProcessingProductId)}
                  onPress={() =>
                    void requestStorePurchase(pack.id as StoreProductId)
                  }
                  style={({ pressed }) => [
                    styles.shopItem,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <View style={styles.shopItemIcon}>
                    <UiIcon source={UI_ICONS.hintCurrency} size={36} />
                  </View>
                  <View style={styles.shopItemCopy}>
                    <View style={styles.shopItemTitleRow}>
                      <Text style={styles.shopItemTitle}>{pack.label}</Text>
                      {pack.badge && (
                        <Text style={styles.shopItemBadge}>{pack.badge}</Text>
                      )}
                    </View>
                    <Text style={styles.shopItemDescription}>
                      +{pack.amount} {tx("ipucu parası", "hint coins")}
                    </Text>
                  </View>
                  <Text style={styles.shopItemPrice}>
                    {iapProcessingProductId === pack.id ? "…" : pack.price}
                  </Text>
                </Pressable>
              ))}
              <Text style={[styles.shopSectionTitle, styles.shopSectionSpacing]}>
                ◆ {tx("KATMAN PARASI", "LAYER COINS")}
              </Text>
              {[
                {
                  id: "layer_coins_100",
                  amount: 100,
                  price: storePrice("layer_coins_100"),
                  label: tx("Küçük Anahtar", "Small Key"),
                  badge: null,
                },
                {
                  id: "layer_coins_350",
                  amount: 350,
                  price: storePrice("layer_coins_350"),
                  label: tx("Bahçe Anahtarı", "Garden Key"),
                  badge: tx("POPÜLER", "POPULAR"),
                },
                {
                  id: "layer_coins_900",
                  amount: 900,
                  price: storePrice("layer_coins_900"),
                  label: tx("Usta Anahtar", "Master Key"),
                  badge: tx("EN İYİ DEĞER", "BEST VALUE"),
                },
              ].map((pack) => (
                <Pressable
                  key={pack.id}
                  disabled={Boolean(iapProcessingProductId)}
                  onPress={() =>
                    void requestStorePurchase(pack.id as StoreProductId)
                  }
                  style={({ pressed }) => [
                    styles.shopItem,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <View style={styles.shopItemIcon}>
                    <UiIcon source={UI_ICONS.layerCurrency} size={36} />
                  </View>
                  <View style={styles.shopItemCopy}>
                    <View style={styles.shopItemTitleRow}>
                      <Text style={styles.shopItemTitle}>{pack.label}</Text>
                      {pack.badge && (
                        <Text style={styles.shopItemBadge}>{pack.badge}</Text>
                      )}
                    </View>
                    <Text style={styles.shopItemDescription}>
                      +{pack.amount} {tx("katman parası", "layer coins")}
                    </Text>
                  </View>
                  <Text style={styles.shopItemPrice}>
                    {iapProcessingProductId === pack.id ? "…" : pack.price}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tx(
                  "Satın almaları geri yükle",
                  "Restore purchases"
                )}
                disabled={!iapConnected || iapRestoreBusy}
                onPress={() => void restoreStorePurchases()}
                style={({ pressed }) => [
                  styles.purchaseHistoryButton,
                  styles.restorePurchasesButton,
                  (!iapConnected || iapRestoreBusy) && styles.disabledButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <View style={styles.purchaseHistoryIcon}>
                  <Text style={styles.purchaseHistoryIconText}>↻</Text>
                </View>
                <View style={styles.purchaseHistoryButtonCopy}>
                  <Text style={styles.purchaseHistoryButtonTitle}>
                    {iapRestoreBusy
                      ? tx("Geri yükleniyor…", "Restoring…")
                      : tx("Satın Almaları Geri Yükle", "Restore Purchases")}
                  </Text>
                  <Text style={styles.purchaseHistoryButtonMeta}>
                    {tx(
                      "Reklamsız paketi mağaza hesabından geri yükle",
                      "Restore the ad-free pack from your store account"
                    )}
                  </Text>
                </View>
              </Pressable>
              <Text style={styles.shopLegalText}>
                {tx(
                  "Fiyatlar App Store veya Google Play tarafından gösterilir. Ödeme mağaza hesabın üzerinden güvenli biçimde tamamlanır.",
                  "Prices are provided by the App Store or Google Play. Payments are completed securely through your store account."
                )}
              </Text>
            </ScrollView>
            {shopMessage && (
              <View style={styles.shopMessageOverlay}>
                <View style={styles.shopMessageCard}>
                  {shopMessage.icon === "adFree" ? (
                    <AdFreeIcon size={58} active={progress.adsRemoved} />
                  ) : (
                    <UiIcon source={UI_ICONS.layerCurrency} size={58} />
                  )}
                  <Text style={styles.shopMessageTitle}>
                    {shopMessage.title}
                  </Text>
                  <Text style={styles.shopMessageText}>
                    {shopMessage.message}
                  </Text>
                  <Pressable
                    onPress={() => setShopMessage(null)}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>
                      {tx("Tamam", "OK")}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
            {purchaseHistoryVisible && (
              <View style={styles.shopMessageOverlay}>
                <View style={styles.purchaseHistoryCard}>
                  <View style={styles.purchaseHistoryHeader}>
                    <View>
                      <Text style={styles.winOverline}>
                        {tx("MAĞAZA", "SHOP")}
                      </Text>
                      <Text style={styles.purchaseHistoryTitle}>
                        {tx("Satın Alma Geçmişi", "Purchase History")}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setPurchaseHistoryVisible(false)}
                      style={styles.closeButton}
                    >
                      <Text style={styles.closeButtonText}>×</Text>
                    </Pressable>
                  </View>
                  {progress.purchaseHistory.length === 0 ? (
                    <View style={styles.purchaseHistoryEmpty}>
                      <Text style={styles.purchaseHistoryEmptyIcon}>⌁</Text>
                      <Text style={styles.purchaseHistoryEmptyTitle}>
                        {tx(
                          "Henüz satın alma yok",
                          "No purchases yet"
                        )}
                      </Text>
                      <Text style={styles.purchaseHistoryEmptyText}>
                        {tx(
                          "Başarıyla tamamlanan ve doğrulanan satın almaların burada gösterilecek.",
                          "Successfully completed and verified purchases will appear here."
                        )}
                      </Text>
                    </View>
                  ) : (
                    <ScrollView
                      style={styles.purchaseHistoryList}
                      showsVerticalScrollIndicator={false}
                    >
                      {progress.purchaseHistory.map((record) => (
                        <View key={record.id} style={styles.purchaseHistoryRow}>
                          <View style={styles.purchaseHistoryRowIcon}>
                            {record.productId === REMOVE_ADS_PRODUCT_ID ? (
                              <AdFreeIcon size={34} active />
                            ) : (
                              <UiIcon
                                source={
                                  record.productId.startsWith("hint_")
                                    ? UI_ICONS.hintCurrency
                                    : UI_ICONS.layerCurrency
                                }
                                size={34}
                              />
                            )}
                          </View>
                          <View style={styles.purchaseHistoryRowCopy}>
                            <Text style={styles.purchaseHistoryRowTitle}>
                              {record.title}
                            </Text>
                            <Text style={styles.purchaseHistoryRowDate}>
                              {formatPurchaseDate(record.purchasedAt)}
                            </Text>
                          </View>
                          <Text style={styles.purchaseHistoryRowPrice}>
                            {record.price}
                          </Text>
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
      )}

      {settingsVisible && (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={() => setSettingsVisible(false)}
      >
        <View style={[styles.modalBackdrop, modalSafePadding]}>
          <View style={styles.infoCard}>
            <View style={styles.levelCardHeader}>
              <View>
                <Text style={styles.winOverline}>
                  {tx("AYARLAR", "SETTINGS")}
                </Text>
                <Text style={styles.levelCardTitle}>
                  {tx("Bahçe tercihleri", "Garden preferences")}
                </Text>
              </View>
              <Pressable
                onPress={() => setSettingsVisible(false)}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>×</Text>
              </Pressable>
            </View>
            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <Text style={styles.settingTitle}>
                  {tx("Müzik", "Music")}
                </Text>
                <Text style={styles.settingDescription}>
                  {tx(
                    "Sakin bahçe arka plan müziği",
                    "Calm garden background music"
                  )}
                </Text>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{
                  checked: progress.musicEnabled,
                }}
                onPress={() => {
                  playEffect(tapPlayer);
                  setProgress((previous) => ({
                    ...previous,
                    musicEnabled: !previous.musicEnabled,
                  }));
                }}
                style={[
                  styles.switchTrack,
                  progress.musicEnabled && styles.switchTrackActive,
                ]}
              >
                <View
                  style={[
                    styles.switchThumb,
                    progress.musicEnabled && styles.switchThumbActive,
                  ]}
                />
              </Pressable>
            </View>
            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <Text style={styles.settingTitle}>
                  {tx("Ses efektleri", "Sound effects")}
                </Text>
                <Text style={styles.settingDescription}>
                  {tx(
                    "Düğme, dalga ve başarı sesleri",
                    "Button, wave and success sounds"
                  )}
                </Text>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{
                  checked: progress.soundEnabled,
                }}
                onPress={() => {
                  playEffect(tapPlayer);
                  setProgress((previous) => ({
                    ...previous,
                    soundEnabled: !previous.soundEnabled,
                  }));
                }}
                style={[
                  styles.switchTrack,
                  progress.soundEnabled && styles.switchTrackActive,
                ]}
              >
                <View
                  style={[
                    styles.switchThumb,
                    progress.soundEnabled && styles.switchThumbActive,
                  ]}
                />
              </Pressable>
            </View>
            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <Text style={styles.settingTitle}>
                  {tx("Titreşim", "Haptics")}
                </Text>
                <Text style={styles.settingDescription}>
                  {tx(
                    "Dalga ve başarı geri bildirimleri",
                    "Wave and success feedback"
                  )}
                </Text>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{
                  checked: progress.hapticsEnabled,
                }}
                onPress={() => {
                  playEffect(tapPlayer);
                  setProgress((previous) => ({
                    ...previous,
                    hapticsEnabled: !previous.hapticsEnabled,
                  }));
                }}
                style={[
                  styles.switchTrack,
                  progress.hapticsEnabled && styles.switchTrackActive,
                ]}
              >
                <View
                  style={[
                    styles.switchThumb,
                    progress.hapticsEnabled && styles.switchThumbActive,
                  ]}
                />
              </Pressable>
            </View>
            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <Text style={styles.settingTitle}>
                  {tx("Dil", "Language")}
                </Text>
                <Text style={styles.settingDescription}>
                  {tx("Oyun arayüzü dili", "Game interface language")}
                </Text>
              </View>
              <View style={styles.languageSelector}>
                {(["tr", "en"] as AppLanguage[]).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() =>
                      setProgress((previous) => ({
                        ...previous,
                        language: option,
                      }))
                    }
                    style={[
                      styles.languageOption,
                      language === option && styles.languageOptionSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.languageOptionText,
                        language === option &&
                          styles.languageOptionTextSelected,
                      ]}
                    >
                      {option === "tr" ? "TR" : "EN"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Text style={styles.versionText}>
              {tx("Sürüm", "Version")} 1.0.9 • {LEVELS.length}{" "}
              {tx("bölüm", "levels")}
            </Text>
          </View>
        </View>
      </Modal>
      )}
      </ImageBackground>
    </SafeAreaView>
    </LanguageContext.Provider>
  );
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean; recoveryKey: number }
> {
  state = { failed: false, recoveryKey: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Bloomshift recovered from a UI error", error, info);
  }

  retry = () => {
    this.setState((previous) => ({
      failed: false,
      recoveryKey: previous.recoveryKey + 1,
    }));
  };

  render() {
    if (this.state.failed) {
      return (
        <SafeAreaView
          edges={["top", "bottom", "left", "right"]}
          style={styles.crashRecovery}
        >
          <Image
            source={require("./assets/images/app-icon-bloomshift-v2.png")}
            style={styles.crashRecoveryLogo}
          />
          <Text style={styles.crashRecoveryTitle}>
            Garden Paused • Bahçe Kısa Bir Mola Verdi
          </Text>
          <Text style={styles.crashRecoveryText}>
            Your progress is safe. Tap the button below to reload the game.{"\n"}
            İlerlemeniz güvende. Oyunu yeniden yüklemek için aşağıdaki
            düğmeye dokunun.
          </Text>
          <Pressable
            onPress={this.retry}
            style={({ pressed }) => [
              styles.crashRecoveryButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              Return to Game • Oyuna Dön
            </Text>
          </Pressable>
        </SafeAreaView>
      );
    }

    return (
      <React.Fragment key={this.state.recoveryKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <AppContent />
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F4F1E8",
  },
  crashRecovery: {
    flex: 1,
    paddingHorizontal: 28,
    backgroundColor: "#F4F1E8",
    alignItems: "center",
    justifyContent: "center",
  },
  crashRecoveryLogo: {
    width: 104,
    height: 104,
    borderRadius: 30,
    marginBottom: 20,
  },
  crashRecoveryTitle: {
    color: "#20332D",
    fontSize: 25,
    lineHeight: 31,
    fontWeight: "900",
    textAlign: "center",
  },
  crashRecoveryText: {
    maxWidth: 360,
    color: "#66736E",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 9,
    marginBottom: 20,
  },
  crashRecoveryButton: {
    width: "100%",
    maxWidth: 320,
    height: 54,
    borderRadius: 17,
    backgroundColor: "#253C35",
    alignItems: "center",
    justifyContent: "center",
  },
  backgroundImage: {
    flex: 1,
  },
  backgroundImageAsset: {
    opacity: 0.82,
  },
  page: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 30,
    alignItems: "center",
  },
  openingScene: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    overflow: "hidden",
    zIndex: 100,
  },
  openingVeil: {
    backgroundColor: "rgba(244,241,232,0.88)",
  },
  openingBotanical: {
    position: "absolute",
    color: "rgba(53,130,101,0.18)",
    fontSize: 150,
  },
  openingBotanicalLeft: {
    left: -42,
    bottom: 20,
    transform: [{ rotate: "22deg" }],
  },
  openingBotanicalRight: {
    right: -42,
    top: 28,
    transform: [{ rotate: "202deg" }],
  },
  openingLogoStage: {
    width: 190,
    height: 190,
    alignItems: "center",
    justifyContent: "center",
  },
  openingRing: {
    position: "absolute",
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 2,
    borderColor: "#3D7C67",
  },
  openingLogoWrap: {
    width: 126,
    height: 126,
    borderRadius: 38,
    padding: 7,
    backgroundColor: "rgba(255,255,255,0.88)",
    shadowColor: "#24473B",
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  openingLogo: {
    width: 112,
    height: 112,
    borderRadius: 32,
  },
  openingCopy: {
    alignItems: "center",
    marginTop: 8,
  },
  openingTitle: {
    color: "#20332D",
    fontSize: 38,
    lineHeight: 45,
    fontWeight: "900",
    letterSpacing: -1.2,
  },
  openingSubtitle: {
    color: "#5D6E68",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  openingDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 17,
  },
  openingDividerLine: {
    width: 48,
    height: 1,
    backgroundColor: "rgba(53,130,101,0.36)",
  },
  homePage: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 28,
    alignItems: "center",
  },
  homeOpeningSpacer: {
    flex: 1,
    minHeight: "100%",
  },
  homeContent: {
    flex: 1,
    width: "100%",
    maxWidth: 430,
    alignItems: "center",
    justifyContent: "center",
  },
  homeAnimatedSection: {
    width: "100%",
  },
  homeGardenPanel: {
    width: "100%",
    minHeight: 132,
    borderRadius: 25,
    backgroundColor: "rgba(255,253,247,0.92)",
    borderWidth: 1,
    borderColor: "#DCD6C8",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    overflow: "hidden",
    shadowColor: "#29483E",
    shadowOpacity: 0.11,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  homeGardenBotanical: {
    position: "absolute",
    right: -9,
    top: -24,
    color: "rgba(53,130,101,0.12)",
    fontSize: 92,
    transform: [{ rotate: "18deg" }],
  },
  homeGardenPanelRow: {
    minHeight: 86,
    flexDirection: "row",
    alignItems: "center",
  },
  homeGardenArt: {
    width: 112,
    height: 84,
    alignItems: "center",
    justifyContent: "center",
  },
  homeGardenArtRing: {
    position: "absolute",
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 1.5,
    borderColor: "rgba(53,130,101,0.25)",
    backgroundColor: "rgba(225,239,225,0.55)",
  },
  homeGardenFlower: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  homeGardenFlowerLeft: {
    left: 17,
    bottom: 8,
    transform: [{ rotate: "-9deg" }],
  },
  homeGardenFlowerRight: {
    right: 15,
    bottom: 8,
    transform: [{ rotate: "9deg" }],
  },
  homeGardenFlowerTop: {
    top: 2,
  },
  homeGardenCopy: {
    flex: 1,
    paddingLeft: 8,
    paddingRight: 6,
  },
  homeGardenOverline: {
    color: "#2A8067",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  homeGardenTitle: {
    color: "#203A32",
    fontSize: 21,
    lineHeight: 26,
    fontWeight: "900",
    marginTop: 3,
  },
  homeGardenMeta: {
    color: "#737C77",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    marginTop: 4,
  },
  homeGardenPanelFooter: {
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  homeGardenPanelLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(53,130,101,0.18)",
  },
  homeGardenPanelHint: {
    color: "#64736D",
    fontSize: 9,
    fontWeight: "800",
  },
  homeTopRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  homeTopActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  homeWallet: {
    flexDirection: "row",
    gap: 6,
  },
  homeCurrency: {
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 13,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "#DED9CD",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  hintCurrencyIcon: {
    color: "#8B6FD6",
    fontSize: 14,
    fontWeight: "900",
  },
  layerCurrencyIcon: {
    color: "#D59A28",
    fontSize: 14,
    fontWeight: "900",
  },
  homeCurrencyText: {
    color: "#2F473F",
    fontSize: 15,
    fontWeight: "900",
  },
  homeCurrencyLabel: {
    color: "#818681",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  homeSettingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,249,233,0.76)",
    borderWidth: 0.75,
    borderColor: "rgba(201,169,106,0.48)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#24483D",
    shadowOpacity: 0.07,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  homeAdFreeButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "rgba(255,249,233,0.88)",
    borderWidth: 1,
    borderColor: "rgba(201,169,106,0.58)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#24483D",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  homeAdFreeButtonActive: {
    backgroundColor: "rgba(222,245,230,0.96)",
    borderColor: "#6CA783",
  },
  homeBrand: {
    alignItems: "center",
    marginTop: 10,
    marginBottom: 10,
  },
  homeLogoPlaceholder: {
    width: 88,
    height: 88,
  },
  homeLogoSettledWrap: {
    width: 88,
    height: 88,
    borderRadius: 27,
    padding: 5,
    backgroundColor: "rgba(255,255,255,0.88)",
    shadowColor: "#24473B",
    shadowOpacity: 0.24,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 7 },
    elevation: 7,
  },
  homeLogo: {
    width: 78,
    height: 78,
    borderRadius: 23,
  },
  homeTitle: {
    color: "#20332D",
    fontSize: 32,
    lineHeight: 37,
    fontWeight: "900",
    letterSpacing: -1.2,
    marginTop: -2,
  },
  homeSubtitle: {
    color: "#60706A",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  homePlayButton: {
    width: "100%",
    height: 60,
    borderRadius: 20,
    backgroundColor: "#253C35",
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#1E332C",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    marginTop: 9,
  },
  homePlayOverline: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  homePlayText: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
  },
  homePlayArrow: {
    color: "#F1CB53",
    fontSize: 34,
  },
  homeSecondaryRow: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  homeSecondaryButton: {
    flex: 1,
    minHeight: 78,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "#DED9CD",
    padding: 10,
  },
  homeSecondaryIcon: {
    color: "#35A27D",
    fontSize: 22,
  },
  homeSecondaryImage: {
    width: 42,
    height: 42,
    borderRadius: 13,
  },
  homeSecondaryText: {
    color: "#2E453D",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 2,
  },
  homeSecondaryMeta: {
    color: "#858A86",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
  companyBrand: {
    minHeight: 46,
    marginTop: 16,
    paddingTop: 4,
    paddingBottom: 2,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  companyLogo: {
    width: 34,
    height: 34,
    borderRadius: 10,
  },
  companyName: {
    color: "#17386C",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  header: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 7,
    marginBottom: 12,
  },
  headerCopy: {
    flex: 1,
    minHeight: 52,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(224,221,212,0.9)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  brand: {
    color: "#2A7560",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.7,
  },
  levelName: {
    color: "#1D302B",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.7,
  },
  levelMenuShortcut: {
    color: "#76807B",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginTop: 2,
  },
  gameHomeButton: {
    width: 56,
    height: 52,
    borderRadius: 17,
    backgroundColor: "rgba(255,249,233,0.76)",
    borderWidth: 0.75,
    borderColor: "rgba(184,163,109,0.5)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#29483E",
    shadowOpacity: 0.07,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  gameHomeButtonText: {
    color: "#29483E",
    fontSize: 8,
    lineHeight: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
    marginTop: 1,
  },
  levelPill: {
    minWidth: 62,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E0DDD4",
  },
  levelPillTop: {
    fontSize: 9,
    fontWeight: "800",
    color: "#7C817C",
    letterSpacing: 1,
  },
  levelPillNumber: {
    fontSize: 15,
    fontWeight: "900",
    color: "#253C35",
  },
  headerRewards: {
    gap: 3,
    marginRight: 5,
  },
  rewardPill: {
    minWidth: 54,
    height: 29,
    paddingHorizontal: 4,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderWidth: 1,
    borderColor: "#E0DDD4",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  rewardPillIcon: {
    color: "#C79423",
    fontSize: 12,
    fontWeight: "900",
  },
  rewardPillText: {
    color: "#35453F",
    fontSize: 11,
    fontWeight: "900",
  },
  settingsButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: 5,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderWidth: 1,
    borderColor: "#E0DDD4",
    alignItems: "center",
    justifyContent: "center",
  },
  settingsButtonText: {
    color: "#40504B",
    fontSize: 17,
  },
  progressTrack: {
    width: "100%",
    height: 5,
    backgroundColor: "#DEDCD4",
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 12,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#35A27D",
    borderRadius: 10,
  },
  previewCard: {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.88)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E0DDD4",
    paddingHorizontal: 15,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  previewCopy: {
    flex: 1,
    paddingRight: 10,
  },
  previewTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  previewEyebrow: {
    color: "#2A7560",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  difficultyBadge: {
    backgroundColor: "#D8F1E8",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  difficultyMedium: {
    backgroundColor: "#FFF0C2",
  },
  difficultyHard: {
    backgroundColor: "#F7D9D7",
  },
  difficultyBadgeText: {
    color: "#3E554E",
    fontSize: 9,
    fontWeight: "900",
  },
  previewText: {
    color: "#6D736F",
    fontSize: 11,
    marginTop: 4,
  },
  previewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  previewCell: {
    borderRadius: 2,
  },
  instructionRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#253C35",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  stepNumberText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 12,
  },
  instructionText: {
    flex: 1,
    color: "#4E5B57",
    fontSize: 13,
    fontWeight: "600",
  },
  board: {
    position: "relative",
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 12,
  },
  cell: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  cellColorInset: {
    position: "absolute",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.42)",
    shadowColor: "#3B4A44",
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  cellColorSoftLight: {
    position: "absolute",
    width: "92%",
    height: "72%",
    left: "-18%",
    top: "-22%",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.28)",
    transform: [{ rotate: "-12deg" }],
  },
  cellColorDepth: {
    position: "absolute",
    width: "105%",
    height: "64%",
    right: "-22%",
    bottom: "-27%",
    borderRadius: 999,
    transform: [{ rotate: "-8deg" }],
  },
  cellColorPaperWash: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: "rgba(255,250,236,0.2)",
    borderRadius: 12,
    backgroundColor: "rgba(255,248,230,0.035)",
  },
  cellHerbariumFrame: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  pieceSlot: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  movingPieceGroup: {
    position: "absolute",
    zIndex: 7,
  },
  petal: {
    position: "absolute",
    transform: [{ rotate: "45deg" }],
  },
  flowerCenter: {
    position: "absolute",
    backgroundColor: "#FFF8E8",
    borderWidth: 2,
    borderColor: "#E7D7A8",
  },
  rippleButton: {
    position: "absolute",
    backgroundColor: "rgba(255,249,233,0.74)",
    borderColor: "rgba(201,169,106,0.5)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 12,
    shadowColor: "#1F332D",
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  waveRing: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#315C50",
    backgroundColor: "transparent",
    zIndex: 10,
  },
  ripplePressed: {
    transform: [{ scale: 0.92 }],
  },
  rippleIcon: {
    lineHeight: 25,
    color: "#253C35",
    fontWeight: "900",
  },
  rippleIconCounter: {
    transform: [{ scaleX: -1 }],
  },
  statusRow: {
    width: "100%",
    minHeight: 50,
    backgroundColor: "rgba(233,230,221,0.88)",
    borderRadius: 16,
    paddingLeft: 14,
    paddingRight: 8,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 11,
  },
  statusText: {
    flex: 1,
    color: "#4E5B57",
    fontSize: 12,
    fontWeight: "600",
    paddingRight: 8,
  },
  moveBadge: {
    minWidth: 54,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  moveBadgeNumber: {
    fontSize: 16,
    lineHeight: 17,
    fontWeight: "900",
    color: "#253C35",
  },
  moveBadgeLabel: {
    fontSize: 7,
    fontWeight: "900",
    color: "#7A817D",
    letterSpacing: 0.8,
  },
  directionCard: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 11,
  },
  directionLabel: {
    color: "#6F7772",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  directionMoveCount: {
    color: "#354B44",
    fontSize: 11,
    fontWeight: "900",
    marginTop: 3,
  },
  directionButtons: {
    flexDirection: "row",
    backgroundColor: "rgba(255,249,233,0.46)",
    padding: 3,
    borderRadius: 14,
    gap: 3,
  },
  directionButton: {
    minWidth: 83,
    height: 42,
    borderRadius: 11,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 0.75,
    borderColor: "transparent",
  },
  directionButtonSelected: {
    backgroundColor: "rgba(255,247,226,0.82)",
    borderColor: "rgba(201,169,106,0.52)",
  },
  directionSymbol: {
    color: "#5C6561",
    fontSize: 19,
    fontWeight: "900",
  },
  directionSymbolSelected: {
    color: "#FFFFFF",
  },
  directionText: {
    color: "#5C6561",
    fontSize: 12,
    fontWeight: "800",
  },
  directionTextSelected: {
    color: "#24483D",
  },
  controlDisabled: {
    opacity: 0.55,
  },
  actionRow: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
  },
  secondaryButton: {
    width: 70,
    height: 58,
    borderRadius: 18,
    backgroundColor: "rgba(255,253,247,0.72)",
    borderWidth: 0.75,
    borderColor: "rgba(125,140,132,0.34)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#253C35",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  secondaryButtonIcon: {
    color: "#41524C",
    fontSize: 20,
    fontWeight: "900",
  },
  secondaryButtonText: {
    color: "#41524C",
    fontSize: 14,
    fontWeight: "900",
  },
  hintButton: {
    width: 70,
    height: 58,
    borderRadius: 18,
    backgroundColor: "rgba(255,244,215,0.76)",
    borderWidth: 0.75,
    borderColor: "rgba(217,171,45,0.42)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#725A12",
    shadowOpacity: 0.07,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  hintCostBadge: {
    position: "absolute",
    top: -13,
    right: -7,
    minWidth: 42,
    height: 25,
    borderRadius: 13,
    paddingHorizontal: 6,
    backgroundColor: "#FFFDF7",
    borderWidth: 1,
    borderColor: "#CDBEE9",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    zIndex: 4,
    shadowColor: "#3D2B67",
    shadowOpacity: 0.14,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  hintCostBadgeText: {
    color: "#5D439B",
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "900",
  },
  gameSettingsButton: {
    width: 70,
    height: 58,
    borderRadius: 18,
    backgroundColor: "rgba(255,249,233,0.72)",
    borderWidth: 0.75,
    borderColor: "rgba(201,169,106,0.44)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#253C35",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  gameSettingsIcon: {
    color: "#40544D",
    fontSize: 23,
    lineHeight: 25,
  },
  gameSettingsText: {
    color: "#40544D",
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.6,
    marginTop: 2,
  },
  hintButtonIcon: {
    color: "#453815",
    fontSize: 17,
  },
  hintButtonText: {
    color: "#453815",
    fontSize: 14,
    fontWeight: "900",
  },
  actionButtonOverline: {
    color: "#87908C",
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.7,
    marginBottom: 1,
  },
  actionButtonOverlineDark: {
    color: "rgba(69,56,21,0.62)",
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.7,
    marginBottom: 1,
  },
  buttonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(20, 35, 30, 0.62)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalBackdropStrong: {
    flex: 1,
    backgroundColor: "rgba(16, 29, 25, 0.78)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  languageWelcomeCard: {
    width: "100%",
    maxWidth: 390,
    overflow: "hidden",
    borderRadius: 32,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.82)",
    backgroundColor: "#FFF9EA",
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 22,
    alignItems: "center",
    shadowColor: "#10251E",
    shadowOpacity: 0.34,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  languageWelcomeGlow: {
    position: "absolute",
    width: 250,
    height: 250,
    top: -158,
    borderRadius: 125,
    backgroundColor: "rgba(243,189,54,0.25)",
  },
  languageWelcomeLogo: {
    width: 76,
    height: 76,
    borderRadius: 23,
    marginBottom: 12,
  },
  languageWelcomeOverline: {
    color: "#2F806A",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 1.25,
    textAlign: "center",
  },
  languageWelcomeTitle: {
    color: "#243B33",
    fontSize: 25,
    lineHeight: 31,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 7,
  },
  languageWelcomeTurkishTitle: {
    color: "#64716C",
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 1,
  },
  languageWelcomeText: {
    color: "#78817D",
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 10,
    marginBottom: 18,
  },
  languageWelcomeOptions: {
    width: "100%",
    gap: 10,
  },
  languageWelcomeOption: {
    width: "100%",
    minHeight: 64,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#D9D3C6",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
  },
  languageWelcomeOptionPrimary: {
    borderColor: "#254B3F",
    backgroundColor: "#254B3F",
  },
  languageWelcomeFlag: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "rgba(243,189,54,0.94)",
    color: "#443713",
    fontSize: 12,
    lineHeight: 38,
    fontWeight: "900",
    textAlign: "center",
    overflow: "hidden",
  },
  languageWelcomeOptionCopy: {
    flex: 1,
    paddingHorizontal: 12,
  },
  languageWelcomeOptionTitle: {
    color: "#2B413A",
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "900",
  },
  languageWelcomeOptionTitleLight: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "900",
  },
  languageWelcomeOptionText: {
    color: "#78817D",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
    marginTop: 1,
  },
  languageWelcomeOptionTextLight: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
    marginTop: 1,
  },
  languageWelcomeArrow: {
    color: "#2F806A",
    fontSize: 20,
    fontWeight: "900",
  },
  languageWelcomeArrowLight: {
    color: "#F3BD36",
    fontSize: 20,
    fontWeight: "900",
  },
  winCard: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#FFF9E9",
    borderRadius: 30,
    borderWidth: 3,
    borderColor: "#244C3E",
    padding: 16,
    alignItems: "center",
    maxHeight: "96%",
    shadowColor: "#162E26",
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  winCardScroll: {
    width: "100%",
    flexShrink: 1,
  },
  winCardScrollContent: {
    width: "100%",
    alignItems: "center",
    paddingBottom: 2,
  },
  winBotanicalCorner: {
    position: "absolute",
    right: 17,
    top: 10,
    color: "#91A27A",
    fontSize: 29,
    opacity: 0.75,
  },
  winOverline: {
    color: "#315C4B",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  winTitle: {
    color: "#173F34",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 4,
  },
  winStarPanel: {
    width: "100%",
    borderRadius: 24,
    paddingTop: 11,
    paddingBottom: 10,
    paddingHorizontal: 14,
    marginTop: 8,
    marginBottom: 7,
    alignItems: "center",
    backgroundColor: "rgba(255,253,247,0.94)",
    borderWidth: 1.5,
    borderColor: "rgba(224,176,51,0.55)",
    shadowColor: "#856018",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  winStarPanelLabel: {
    color: "#244A3D",
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  winStarPanelDivider: {
    width: "62%",
    height: 1,
    marginTop: 5,
    marginBottom: 6,
    backgroundColor: "rgba(218,184,98,0.45)",
  },
  winStarPanelStats: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  winStarPanelStat: {
    color: "#6B5730",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  winStarPanelDot: {
    color: "#C99E2F",
    fontSize: 13,
    lineHeight: 15,
    fontWeight: "900",
  },
  premiumBouquet: {
    width: 244,
    height: 218,
    marginTop: -3,
    marginBottom: -7,
  },
  premiumBouquetImage: {
    width: "100%",
    height: "100%",
  },
  bouquet: {
    width: 200,
    height: 132,
    marginTop: 12,
    position: "relative",
  },
  bouquetStem: {
    position: "absolute",
    width: 4,
    height: 88,
    top: 42,
    borderRadius: 3,
    backgroundColor: "#477664",
    transformOrigin: "bottom",
  },
  bouquetLeaf: {
    position: "absolute",
    width: 27,
    height: 15,
    borderRadius: 14,
    backgroundColor: "#5B8D76",
    top: 86,
  },
  bouquetLeafLeft: {
    left: 57,
    transform: [{ rotate: "25deg" }],
  },
  bouquetLeafRight: {
    right: 50,
    transform: [{ rotate: "-27deg" }],
  },
  bouquetFlower: {
    position: "absolute",
    zIndex: 3,
  },
  bouquetTie: {
    position: "absolute",
    width: 42,
    height: 14,
    borderRadius: 8,
    backgroundColor: "#EABB35",
    left: 79,
    bottom: 3,
    zIndex: 4,
  },
  stars: {
    flexDirection: "row",
    gap: 8,
    marginVertical: 13,
  },
  star: {
    color: "#EABB35",
    fontSize: 34,
  },
  starInactive: {
    color: "#D8D6CF",
  },
  starRewardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 5,
    marginBottom: 1,
  },
  starRewardRowCompact: {
    gap: 4,
    marginTop: 3,
  },
  winStarMeta: {
    color: "#876018",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    letterSpacing: 0.7,
    marginBottom: 2,
  },
  winText: {
    color: "#68706C",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 13,
  },
  winRewardCard: {
    width: "100%",
    borderRadius: 14,
    backgroundColor: "#F2EFE5",
    padding: 11,
    marginTop: -8,
    marginBottom: 14,
    alignItems: "center",
  },
  winRewardTitle: {
    color: "#38544B",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  animatedRewardsRow: {
    width: "100%",
    flexDirection: "row",
    gap: 9,
    marginTop: -3,
    marginBottom: 12,
  },
  animatedRewardCard: {
    flex: 1,
    minHeight: 92,
    borderRadius: 17,
    borderWidth: 1.5,
    backgroundColor: "#F9F6EE",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  animatedRewardBalanceMath: {
    color: "#65726D",
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    marginTop: 4,
  },
  animatedRewardSymbol: {
    position: "absolute",
    left: 7,
    top: 7,
  },
  animatedRewardValue: {
    color: "#2A4038",
    fontSize: 25,
    lineHeight: 28,
    fontWeight: "900",
  },
  animatedRewardLabel: {
    color: "#777E7A",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  doubleRewardButton: {
    width: "100%",
    minHeight: 60,
    borderRadius: 17,
    backgroundColor: "#FFF1C5",
    borderWidth: 1,
    borderColor: "#E7C75E",
    paddingHorizontal: 13,
    marginBottom: 9,
    flexDirection: "row",
    alignItems: "center",
  },
  doubleRewardIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#E1B934",
    color: "#FFFFFF",
    textAlign: "center",
    lineHeight: 34,
    fontSize: 13,
  },
  doubleRewardCopy: {
    flex: 1,
    paddingHorizontal: 10,
  },
  doubleRewardTitle: {
    color: "#51420F",
    fontSize: 13,
    fontWeight: "900",
  },
  doubleRewardMeta: {
    color: "#877534",
    fontSize: 9,
    marginTop: 2,
  },
  doubleRewardBadge: {
    color: "#7E6310",
    fontSize: 20,
    fontWeight: "900",
  },
  winUnlockText: {
    color: "#2A856B",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 5,
    textAlign: "center",
  },
  primaryButton: {
    width: "100%",
    height: 54,
    borderRadius: 16,
    backgroundColor: "#253C35",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  primaryButtonArrow: {
    position: "absolute",
    right: 18,
    color: "#FFFFFF",
    fontSize: 22,
  },
  keepPlaying: {
    paddingTop: 15,
    paddingHorizontal: 20,
  },
  keepPlayingText: {
    color: "#68706C",
    fontSize: 13,
    fontWeight: "700",
  },
  levelScreen: {
    flex: 1,
    backgroundColor: "#F7F1E4",
  },
  levelInlineOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    backgroundColor: "rgba(16,29,25,0.76)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  levelScreenBackground: {
    opacity: 0.24,
  },
  levelScreenSafe: {
    flex: 1,
  },
  levelScreenTop: {
    minHeight: 54,
    paddingHorizontal: 16,
    paddingTop: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  levelHomeButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#17352D",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  levelScreenWallet: {
    flexDirection: "row",
    gap: 7,
  },
  levelScreenCurrency: {
    height: 40,
    minWidth: 78,
    paddingLeft: 4,
    paddingRight: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#DED4BF",
    backgroundColor: "rgba(255,253,247,0.96)",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    shadowColor: "#614F2A",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  levelScreenCurrencyText: {
    color: "#173F35",
    fontSize: 16,
    fontWeight: "900",
  },
  levelTitleDecor: {
    height: 55,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  levelScreenTitle: {
    color: "#124839",
    fontSize: 36,
    lineHeight: 43,
    fontWeight: "900",
    letterSpacing: -1.1,
    textShadowColor: "rgba(255,255,255,0.7)",
    textShadowRadius: 3,
  },
  levelTitleFlower: {
    color: "#E76F61",
    fontSize: 16,
  },
  difficultyTabs: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 9,
  },
  difficultyTab: {
    flex: 1,
    height: 43,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#DED5C2",
    backgroundColor: "rgba(255,253,247,0.94)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#4F452C",
    shadowOpacity: 0.09,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  difficultyTabSelected: {
    backgroundColor: "#145342",
    borderColor: "#145342",
  },
  difficultyTabText: {
    color: "#17483C",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  difficultyTabTextSelected: {
    color: "#FFFFFF",
  },
  modePickerWrap: {
    height: 43,
    marginHorizontal: 16,
    marginBottom: 9,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: "rgba(255,253,247,0.96)",
    borderWidth: 1,
    borderColor: "#DED5C2",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 30,
  },
  modePickerLabel: {
    color: "#718078",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  modePickerButton: {
    minWidth: 132,
    height: 33,
    borderRadius: 17,
    paddingHorizontal: 12,
    backgroundColor: "#145342",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  modePickerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#8ED4A8",
  },
  modePickerDotMedium: {
    backgroundColor: "#F2C257",
  },
  modePickerDotHard: {
    backgroundColor: "#EE8176",
  },
  modePickerButtonText: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  modePickerChevron: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    marginTop: -2,
  },
  modePickerMenu: {
    position: "absolute",
    top: 39,
    right: 0,
    width: 156,
    borderRadius: 17,
    padding: 5,
    backgroundColor: "#FFFDF7",
    borderWidth: 1,
    borderColor: "#D8D1C1",
    shadowColor: "#243F36",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 12,
  },
  modePickerOption: {
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modePickerOptionSelected: {
    backgroundColor: "#E6F0E9",
  },
  modePickerOptionText: {
    color: "#496059",
    fontSize: 12,
    fontWeight: "800",
  },
  modePickerOptionTextSelected: {
    color: "#145342",
    fontWeight: "900",
  },
  layerGardenScroll: {
    flexGrow: 0,
    marginBottom: 8,
  },
  layerGardenCards: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    gap: 8,
  },
  layerGardenCard: {
    width: 96,
    height: 82,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#E1D8C5",
    backgroundColor: "rgba(255,253,247,0.96)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#4D432C",
    shadowOpacity: 0.11,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  layerGardenCardSelected: {
    borderWidth: 2.5,
    borderColor: "#175242",
    backgroundColor: "#FFF8E8",
  },
  layerGardenSize: {
    color: "#17483C",
    fontSize: 16,
    fontWeight: "900",
    marginTop: -2,
  },
  layerGardenMeta: {
    minHeight: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  layerGardenCheck: {
    color: "#4F8B6B",
    fontSize: 12,
    fontWeight: "900",
  },
  layerGardenMetaText: {
    color: "#77827D",
    fontSize: 9,
    fontWeight: "800",
  },
  layerGardenCost: {
    color: "#765912",
    fontSize: 11,
    fontWeight: "900",
  },
  layerGardenLocked: {
    color: "#746F65",
    fontSize: 14,
    lineHeight: 18,
  },
  levelProgressCard: {
    minHeight: 62,
    borderRadius: 20,
    backgroundColor: "rgba(255,253,247,0.96)",
    borderWidth: 1,
    borderColor: "#E1D8C5",
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#4D432C",
    shadowOpacity: 0.11,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  levelProgressIcon: {
    width: 45,
    alignItems: "center",
  },
  levelProgressCopy: {
    flex: 1,
    paddingLeft: 7,
  },
  levelProgressTitle: {
    color: "#17483C",
    fontSize: 12,
    fontWeight: "900",
  },
  levelProgressTrack: {
    height: 7,
    borderRadius: 5,
    backgroundColor: "#EAE3D4",
    overflow: "hidden",
    marginTop: 7,
  },
  levelProgressFill: {
    height: "100%",
    borderRadius: 5,
  },
  levelBottomBar: {
    height: 68,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#124A3C",
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#0A2D25",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -5 },
    elevation: 10,
  },
  levelBottomAction: {
    minWidth: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  levelBottomText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  levelBottomLogoWrap: {
    width: 58,
    height: 58,
    borderRadius: 19,
    marginTop: -22,
    padding: 4,
    backgroundColor: "#F7F1E4",
    shadowColor: "#092B23",
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  levelBottomLogo: {
    width: 50,
    height: 50,
    borderRadius: 15,
  },
  levelCard: {
    width: "100%",
    maxWidth: 430,
    maxHeight: "94%",
    backgroundColor: "#FFFDF7",
    borderRadius: 28,
    padding: 18,
  },
  infoCard: {
    width: "100%",
    maxWidth: 400,
    maxHeight: "94%",
    backgroundColor: "#FFFDF7",
    borderRadius: 28,
    padding: 24,
  },
  levelCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  levelWallet: {
    marginLeft: "auto",
    marginRight: 8,
    gap: 2,
    alignItems: "flex-end",
  },
  levelWalletText: {
    color: "#3D504A",
    fontSize: 11,
    fontWeight: "900",
  },
  levelCardTitle: {
    color: "#20332D",
    fontSize: 24,
    fontWeight: "900",
    marginTop: 3,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#EAE7DE",
    alignItems: "center",
    justifyContent: "center",
  },
  closeButtonText: {
    color: "#374A44",
    fontSize: 26,
    lineHeight: 28,
  },
  layerTabs: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 13,
  },
  layerTab: {
    flex: 1,
    minHeight: 51,
    borderRadius: 13,
    backgroundColor: "#ECE9E0",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  layerTabSelected: {
    backgroundColor: "#253C35",
    borderColor: "#253C35",
  },
  layerTabSize: {
    color: "#40504B",
    fontSize: 14,
    fontWeight: "900",
  },
  layerTabCount: {
    color: "#7A817D",
    fontSize: 8,
    fontWeight: "700",
    marginTop: 2,
  },
  layerTabTextSelected: {
    color: "#FFFFFF",
  },
  groupSections: {
    borderRadius: 17,
    backgroundColor: "#F2EFE7",
    paddingVertical: 7,
    paddingHorizontal: 8,
    marginBottom: 10,
    gap: 5,
  },
  groupSectionRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
  },
  groupSectionLabel: {
    width: 52,
    color: "#64706B",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  groupTabs: {
    gap: 5,
    paddingRight: 4,
  },
  groupTab: {
    width: 72,
    height: 40,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: "#D8D4C9",
    backgroundColor: "#FFFDF8",
    alignItems: "center",
    justifyContent: "center",
  },
  groupTabSize: {
    color: "#344A42",
    fontSize: 11,
    fontWeight: "900",
  },
  groupTabMeta: {
    color: "#7E837F",
    fontSize: 8,
    fontWeight: "800",
    marginTop: 1,
  },
  groupTabTextSelected: {
    color: "#FFFFFF",
  },
  levelScroll: {
    flex: 1,
    width: "100%",
  },
  levelScrollContent: {
    paddingTop: 2,
    paddingBottom: 16,
  },
  levelRangeCard: {
    backgroundColor: "#F3F0E8",
    borderRadius: 15,
    padding: 11,
    marginBottom: 9,
  },
  levelRangeTitle: {
    color: "#35453F",
    fontSize: 11,
    fontWeight: "900",
  },
  levelRangeText: {
    color: "#7A817D",
    fontSize: 9,
    marginTop: 3,
  },
  levelGridRow: {
    justifyContent: "space-between",
    marginBottom: 8,
    paddingHorizontal: 13,
  },
  levelGridRowShort: {
    justifyContent: "center",
    gap: 12,
  },
  levelTile: {
    width: "18%",
    aspectRatio: 0.74,
    minHeight: 78,
    padding: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  levelFlowerPressable: {
    width: "100%",
    height: "100%",
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  levelUnlockHalo: {
    position: "absolute",
    width: "88%",
    aspectRatio: 1,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: "#F0B92F",
    backgroundColor: "rgba(255,211,82,0.2)",
    zIndex: 0,
  },
  levelFlowerVine: {
    position: "absolute",
    left: "-35%",
    right: "-35%",
    top: "46%",
    height: 3,
    borderRadius: 3,
    backgroundColor: "#78936E",
    opacity: 0.65,
    zIndex: 0,
  },
  levelFlowerVineLocked: {
    backgroundColor: "#B9B3A4",
    opacity: 0.45,
  },
  levelMedallionImage: {
    position: "absolute",
    width: "98%",
    height: "82%",
    top: 0,
    zIndex: 1,
  },
  levelMedallionContent: {
    position: "absolute",
    width: "44%",
    aspectRatio: 1,
    top: "20.5%",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  levelFlowerPetal: {
    position: "absolute",
    width: "43%",
    height: "43%",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(37,60,53,0.14)",
    zIndex: 1,
  },
  levelFlowerPetalTop: {
    top: 0,
    left: "28.5%",
  },
  levelFlowerPetalRight: {
    right: 0,
    top: "28.5%",
  },
  levelFlowerPetalBottom: {
    bottom: 0,
    left: "28.5%",
  },
  levelFlowerPetalLeft: {
    left: 0,
    top: "28.5%",
  },
  levelFlowerCenter: {
    position: "absolute",
    width: "58%",
    height: "58%",
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#253C35",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    zIndex: 2,
  },
  levelTileCurrent: {
    shadowColor: "#E5AC24",
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  levelTileComplete: {
    shadowColor: "#315E4A",
    shadowOpacity: 0.16,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  levelTileNew: {
    shadowColor: "#E7BC37",
    shadowOpacity: 0.75,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
    elevation: 7,
  },
  levelTileLock: {
    position: "absolute",
    right: -3,
    bottom: -2,
    color: "#645F55",
    fontSize: 8,
    lineHeight: 9,
  },
  levelTileNumber: {
    width: "100%",
    color: "#183E34",
    fontSize: 13.5,
    lineHeight: 16,
    fontWeight: "900",
    textAlign: "center",
    includeFontPadding: false,
  },
  levelTileCheck: {
    position: "absolute",
    right: -3,
    bottom: -2,
    color: "#3F785B",
    fontSize: 9,
    lineHeight: 10,
    fontWeight: "900",
  },
  levelTileStars: {
    position: "absolute",
    left: -10,
    right: -10,
    bottom: -14,
    flexDirection: "row",
    justifyContent: "center",
    gap: 0,
    zIndex: 4,
  },
  levelTileNumberActive: {
    color: "#FFFFFF",
  },
  levelTileMeta: {
    position: "absolute",
    bottom: 0,
    color: "#817966",
    fontSize: 6.8,
    lineHeight: 9,
    fontWeight: "900",
    letterSpacing: 0.2,
    zIndex: 3,
  },
  levelTileMetaComplete: {
    color: "#256246",
  },
  levelTileMetaCurrent: {
    color: "#A46E05",
  },
  levelTileMetaActive: {
    color: "rgba(255,255,255,0.88)",
  },
  levelMenuNote: {
    color: "#7A817D",
    fontSize: 12,
    textAlign: "center",
    paddingVertical: 5,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F2EFE5",
    borderRadius: 16,
    padding: 14,
  },
  settingCopy: {
    flex: 1,
    paddingRight: 12,
  },
  settingTitle: {
    color: "#35453F",
    fontSize: 14,
    fontWeight: "900",
  },
  settingDescription: {
    color: "#737B77",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  switchTrack: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#CBCBC5",
    padding: 3,
  },
  switchTrackActive: {
    backgroundColor: "#35A27D",
  },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#FFFFFF",
  },
  switchThumbActive: {
    transform: [{ translateX: 20 }],
  },
  languageSelector: {
    flexDirection: "row",
    padding: 3,
    borderRadius: 15,
    backgroundColor: "#DDE2DB",
  },
  languageOption: {
    width: 38,
    height: 28,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  languageOptionSelected: {
    backgroundColor: "#2A8067",
  },
  languageOptionText: {
    color: "#607069",
    fontSize: 11,
    fontWeight: "900",
  },
  languageOptionTextSelected: {
    color: "#FFFFFF",
  },
  privacyCard: {
    backgroundColor: "#F8F6EF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E1D7",
    padding: 14,
    marginTop: 10,
  },
  shopBalance: {
    flex: 1,
    borderRadius: 17,
    backgroundColor: "#F2EFE5",
    paddingVertical: 12,
    paddingHorizontal: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  shopBalances: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 5,
  },
  shopBalanceIcon: {
    color: "#C79423",
    fontSize: 24,
    fontWeight: "900",
  },
  shopBalanceValue: {
    color: "#2F473F",
    fontSize: 25,
    fontWeight: "900",
  },
  shopBalanceLabel: {
    color: "#747B77",
    fontSize: 9,
    fontWeight: "700",
  },
  purchaseHistoryButton: {
    minHeight: 53,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#DED7C8",
    backgroundColor: "#FAF8F1",
    paddingHorizontal: 10,
    marginTop: 3,
    marginBottom: 5,
    flexDirection: "row",
    alignItems: "center",
  },
  restorePurchasesButton: {
    marginTop: 12,
    marginBottom: 8,
  },
  disabledButton: {
    opacity: 0.55,
  },
  purchaseHistoryIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#E8F1E8",
    borderWidth: 1,
    borderColor: "#C8DCCF",
    alignItems: "center",
    justifyContent: "center",
  },
  purchaseHistoryIconText: {
    color: "#28745D",
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "900",
  },
  purchaseHistoryButtonCopy: {
    flex: 1,
    paddingHorizontal: 10,
  },
  purchaseHistoryButtonTitle: {
    color: "#30473F",
    fontSize: 12,
    fontWeight: "900",
  },
  purchaseHistoryButtonMeta: {
    color: "#7B827E",
    fontSize: 9,
    marginTop: 2,
  },
  purchaseHistoryChevron: {
    color: "#9B7A2B",
    fontSize: 25,
    lineHeight: 27,
    fontWeight: "800",
  },
  purchaseHistoryCard: {
    width: "100%",
    maxHeight: "82%",
    borderRadius: 24,
    backgroundColor: "#FFFDF7",
    borderWidth: 1,
    borderColor: "#E1D7C3",
    padding: 18,
  },
  purchaseHistoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  purchaseHistoryTitle: {
    color: "#243B33",
    fontSize: 21,
    lineHeight: 26,
    fontWeight: "900",
    marginTop: 2,
  },
  purchaseHistoryEmpty: {
    minHeight: 210,
    borderRadius: 20,
    backgroundColor: "#F5F2E9",
    borderWidth: 1,
    borderColor: "#E2DAC8",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  purchaseHistoryEmptyIcon: {
    color: "#4A8B73",
    fontSize: 42,
    lineHeight: 46,
    fontWeight: "900",
  },
  purchaseHistoryEmptyTitle: {
    color: "#30473F",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 5,
  },
  purchaseHistoryEmptyText: {
    color: "#747D78",
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 6,
  },
  purchaseHistoryList: {
    maxHeight: 380,
  },
  purchaseHistoryRow: {
    minHeight: 66,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E1DDD3",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  purchaseHistoryRowIcon: {
    width: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  purchaseHistoryRowCopy: {
    flex: 1,
    paddingHorizontal: 9,
  },
  purchaseHistoryRowTitle: {
    color: "#30473F",
    fontSize: 13,
    fontWeight: "900",
  },
  purchaseHistoryRowDate: {
    color: "#7C847F",
    fontSize: 9,
    marginTop: 3,
  },
  purchaseHistoryRowPrice: {
    color: "#8E6B18",
    fontSize: 12,
    fontWeight: "900",
  },
  shopScroll: {
    maxHeight: 510,
    flexShrink: 1,
  },
  shopAdFreeItem: {
    minHeight: 82,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#C9A94F",
    backgroundColor: "#F7F1D9",
    paddingHorizontal: 11,
    paddingVertical: 10,
    marginTop: 7,
    marginBottom: 5,
    flexDirection: "row",
    alignItems: "center",
  },
  shopAdFreeItemActive: {
    borderColor: "#67A37D",
    backgroundColor: "#E6F3E8",
  },
  shopAdFreeIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  shopAdFreeTitle: {
    color: "#24453A",
    fontSize: 15,
    fontWeight: "900",
  },
  shopAdFreeBadge: {
    color: "#FFFFFF",
    backgroundColor: "#2F8463",
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.4,
    overflow: "hidden",
  },
  shopAdFreeDescription: {
    color: "#66756F",
    fontSize: 9,
    lineHeight: 13,
    marginTop: 3,
  },
  shopAdFreePrice: {
    color: "#8A6513",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "right",
    maxWidth: 70,
  },
  economyGuide: {
    borderRadius: 19,
    backgroundColor: "#F5F1E6",
    borderWidth: 1,
    borderColor: "#DDD3BD",
    padding: 12,
    marginTop: 7,
    marginBottom: 8,
  },
  economyGuideTitle: {
    color: "#29483E",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textAlign: "center",
  },
  economyGuideCaption: {
    color: "#7A817D",
    fontSize: 9,
    lineHeight: 12,
    textAlign: "center",
    marginTop: 3,
    marginBottom: 9,
  },
  economyRewardRow: {
    flexDirection: "row",
    gap: 5,
  },
  economyRewardChip: {
    flex: 1,
    minHeight: 52,
    borderRadius: 13,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.72)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  economyRewardLabel: {
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  economyRewardValues: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  economyRewardAmount: {
    color: "#344A42",
    fontSize: 10,
    fontWeight: "900",
  },
  economyCostList: {
    marginTop: 9,
    borderTopWidth: 1,
    borderTopColor: "#DED6C7",
    paddingTop: 5,
  },
  economyCostRow: {
    minHeight: 35,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#DED8CC",
  },
  economyCostText: {
    flex: 1,
    color: "#52615B",
    fontSize: 10,
    fontWeight: "800",
    marginLeft: 7,
  },
  economyCostValue: {
    color: "#7B5C12",
    fontSize: 12,
    fontWeight: "900",
    marginRight: 4,
  },
  shopSectionTitle: {
    color: "#4C5B56",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 1,
  },
  shopSectionSpacing: {
    marginTop: 17,
  },
  shopItem: {
    minHeight: 67,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E1DED5",
    backgroundColor: "#FFFFFF",
    padding: 11,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  shopItemDisabled: {
    opacity: 0.42,
  },
  shopItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFF0B9",
    alignItems: "center",
    justifyContent: "center",
  },
  shopItemCopy: {
    flex: 1,
    paddingHorizontal: 10,
  },
  shopItemTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
  },
  shopItemTitle: {
    color: "#30473F",
    fontSize: 14,
    fontWeight: "900",
  },
  shopItemBadge: {
    color: "#FFFFFF",
    backgroundColor: "#3B8D70",
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.35,
    overflow: "hidden",
  },
  shopItemDescription: {
    color: "#7A817D",
    fontSize: 10,
    marginTop: 2,
  },
  shopItemPrice: {
    color: "#9B761B",
    fontSize: 13,
    fontWeight: "900",
  },
  shopLegalText: {
    color: "#858B87",
    fontSize: 9,
    lineHeight: 13,
    textAlign: "center",
    paddingHorizontal: 18,
    marginTop: 14,
    marginBottom: 6,
  },
  shopMessageOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    borderRadius: 28,
    backgroundColor: "rgba(20,35,30,0.76)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  shopMessageCard: {
    width: "100%",
    borderRadius: 24,
    backgroundColor: "#FFFDF7",
    borderWidth: 1,
    borderColor: "#E1D7C3",
    padding: 22,
    alignItems: "center",
  },
  shopMessageTitle: {
    color: "#243B33",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 10,
  },
  shopMessageText: {
    color: "#6C7671",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 7,
    marginBottom: 16,
  },
  unlockCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 30,
    backgroundColor: "#FFFDF7",
    borderWidth: 1,
    borderColor: "#E1D7C3",
    padding: 20,
    alignItems: "center",
    shadowColor: "#172A24",
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  unlockGardenHero: {
    width: "100%",
    height: 116,
    borderRadius: 22,
    overflow: "hidden",
    marginBottom: 15,
  },
  unlockGardenHeroImage: {
    borderRadius: 22,
  },
  unlockGardenHeroShade: {
    flex: 1,
    backgroundColor: "rgba(255,253,247,0.38)",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  unlockGardenFlower: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(255,253,247,0.88)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#183D32",
    shadowOpacity: 0.18,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  unlockGardenBadge: {
    maxWidth: 132,
    minHeight: 42,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: "rgba(20,74,60,0.92)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  unlockGardenBadgeText: {
    flexShrink: 1,
    color: "#FFFFFF",
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  hintConfirmCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 30,
    backgroundColor: "#FFFDF7",
    borderWidth: 1,
    borderColor: "#E1D7C3",
    padding: 24,
    alignItems: "center",
    shadowColor: "#172A24",
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  hintConfirmIcon: {
    width: 94,
    height: 94,
    borderRadius: 30,
    backgroundColor: "#F4EEE1",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 13,
  },
  hintConfirmTitle: {
    color: "#243B33",
    fontSize: 24,
    lineHeight: 29,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 6,
  },
  hintConfirmText: {
    color: "#6C7671",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 9,
    marginBottom: 16,
  },
  hintPricePill: {
    minWidth: 178,
    height: 56,
    borderRadius: 19,
    backgroundColor: "#EEE7FA",
    borderWidth: 1,
    borderColor: "#CDBEE9",
    paddingHorizontal: 10,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  hintPriceValue: {
    color: "#5D439B",
    fontSize: 23,
    fontWeight: "900",
  },
  hintPriceLabel: {
    color: "#8875AE",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  unlockIcon: {
    fontSize: 38,
    marginBottom: 8,
  },
  unlockTitle: {
    color: "#243B33",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 5,
  },
  unlockText: {
    color: "#6C7671",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 13,
  },
  unlockBalanceCard: {
    width: "100%",
    minHeight: 68,
    borderRadius: 20,
    backgroundColor: "#FFF4D6",
    borderWidth: 1,
    borderColor: "#E8CC77",
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  unlockBalanceColumn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  unlockBalanceLabel: {
    color: "#8B7540",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 2,
  },
  unlockBalanceValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  unlockBalanceDivider: {
    width: 1,
    height: 42,
    backgroundColor: "rgba(148,111,24,0.22)",
  },
  unlockBalanceOwned: {
    color: "#28483E",
    fontSize: 22,
    fontWeight: "900",
  },
  unlockShortfall: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "#FBE3DF",
    borderWidth: 1,
    borderColor: "#EAB4AA",
    marginBottom: 11,
  },
  unlockShortfallText: {
    color: "#A1463C",
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  unlockStorePrimary: {
    backgroundColor: "#B77B19",
  },
  unlockCostPill: {
    minWidth: 180,
    height: 54,
    borderRadius: 18,
    backgroundColor: "#FFF1C8",
    borderWidth: 1,
    borderColor: "#E7C762",
    paddingHorizontal: 16,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  unlockCostValue: {
    color: "#72570A",
    fontSize: 23,
    fontWeight: "900",
  },
  unlockCostBalance: {
    color: "#8A7435",
    fontSize: 9,
    fontWeight: "800",
  },
  unlockShopButton: {
    width: "100%",
    height: 45,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D8D4C9",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 9,
  },
  unlockShopText: {
    color: "#40534C",
    fontSize: 12,
    fontWeight: "900",
  },
  celebrationFlower: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: "#F3EFE2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  layerCelebrationDots: {
    color: "#D4A62E",
    fontSize: 9,
    letterSpacing: 3,
    marginTop: -7,
    marginBottom: 16,
  },
  layerEntryScene: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    backgroundColor: "#F7F1E4",
  },
  layerEntryBackground: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  layerEntryBackgroundImage: {
    opacity: 0.65,
  },
  layerEntryVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(247,241,228,0.78)",
  },
  layerEntryRing: {
    position: "absolute",
    width: 142,
    height: 142,
    borderRadius: 71,
    borderWidth: 2,
  },
  layerEntryContent: {
    alignItems: "center",
    paddingHorizontal: 30,
  },
  layerEntryFlowerWrap: {
    width: 154,
    height: 154,
    borderRadius: 77,
    backgroundColor: "rgba(255,253,247,0.92)",
    borderWidth: 1,
    borderColor: "#E3D8C3",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#173E33",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
    elevation: 8,
  },
  layerEntryOverline: {
    color: "#2A8067",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginTop: 24,
  },
  layerEntryTitle: {
    color: "#173F35",
    fontSize: 31,
    lineHeight: 38,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 6,
  },
  layerEntryText: {
    color: "#68756F",
    fontSize: 14,
    fontWeight: "800",
    marginTop: 7,
  },
  tutorialScene: {
    flex: 1,
    backgroundColor: "#F4F1E8",
  },
  tutorialBackground: {
    flex: 1,
  },
  tutorialBackgroundImage: {
    opacity: 0.9,
  },
  tutorialVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(244,241,232,0.76)",
  },
  tutorialSafe: {
    flex: 1,
  },
  tutorialPage: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  tutorialCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 30,
    backgroundColor: "rgba(255,253,247,0.97)",
    borderWidth: 1,
    borderColor: "#D8D2C4",
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    alignItems: "center",
    shadowColor: "#173E33",
    shadowOpacity: 0.17,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  tutorialHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  tutorialMiniLogo: {
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: "#EEF5E9",
    borderWidth: 1,
    borderColor: "#C9DCCF",
    alignItems: "center",
    justifyContent: "center",
  },
  tutorialHeaderCopy: {
    flex: 1,
    paddingLeft: 11,
  },
  tutorialOverline: {
    color: "#2A8067",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  tutorialStepLabel: {
    color: "#718078",
    fontSize: 11,
    fontWeight: "900",
    marginTop: 3,
  },
  tutorialTitle: {
    color: "#183F35",
    fontSize: 25,
    lineHeight: 30,
    fontWeight: "900",
    textAlign: "center",
    maxWidth: 340,
  },
  tutorialText: {
    color: "#67756E",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    textAlign: "center",
    maxWidth: 350,
    marginTop: 7,
    marginBottom: 12,
  },
  tutorialRuleCard: {
    width: "100%",
    minHeight: 46,
    borderRadius: 15,
    backgroundColor: "#F2F5EC",
    borderWidth: 1,
    borderColor: "#D5E0D2",
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  tutorialRuleVisual: {
    minWidth: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  tutorialRuleSwatch: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: "rgba(45,76,66,0.25)",
  },
  tutorialRuleEquals: {
    color: "#31584B",
    fontSize: 16,
    fontWeight: "900",
  },
  tutorialRuleCheck: {
    color: "#2F8B69",
    fontSize: 25,
    lineHeight: 28,
    fontWeight: "900",
  },
  tutorialRuleText: {
    flex: 1,
    color: "#355148",
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "900",
    letterSpacing: 0.35,
    paddingLeft: 8,
  },
  tutorialBoard: {
    position: "relative",
    alignSelf: "center",
    marginVertical: 4,
  },
  tutorialCell: {
    position: "absolute",
    borderRadius: 20,
  },
  tutorialCellColor: {
    position: "absolute",
    left: 4,
    right: 4,
    top: 4,
    bottom: 4,
    borderRadius: 16,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  tutorialPiece: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  tutorialMatchBadge: {
    position: "absolute",
    right: 5,
    top: 5,
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 8,
  },
  tutorialMatchBadgeCorrect: {
    backgroundColor: "#35A27D",
  },
  tutorialMatchBadgeMove: {
    backgroundColor: "#E08055",
  },
  tutorialMatchBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    lineHeight: 14,
    fontWeight: "900",
  },
  tutorialWaveRing: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#DCAA22",
    backgroundColor: "rgba(240,190,47,0.1)",
  },
  tutorialRippleButton: {
    position: "absolute",
    zIndex: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,253,247,0.98)",
    borderWidth: 1.5,
    borderColor: "#E2B52E",
    shadowColor: "#735F16",
    shadowOpacity: 0.22,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  tutorialDots: {
    flexDirection: "row",
    gap: 7,
    marginTop: 13,
    marginBottom: 12,
  },
  tutorialDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#D8D4C8",
  },
  tutorialDotActive: {
    width: 22,
    backgroundColor: "#35A27D",
  },
  tutorialWaitingPill: {
    width: "100%",
    height: 54,
    borderRadius: 17,
    backgroundColor: "#FFF1C5",
    borderWidth: 1,
    borderColor: "#E7C75E",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  tutorialWaitingText: {
    color: "#6F5713",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  tutorialPrimaryButton: {
    width: "100%",
    height: 54,
    borderRadius: 17,
    backgroundColor: "#253C35",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  versionText: {
    color: "#8A8F8B",
    fontSize: 10,
    textAlign: "center",
    marginTop: 16,
  },
});
