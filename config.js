/**
 * Unified Local Configuration & Difficulty Profiles (config.js)
 * Persisted to localStorage with zero external network dependencies.
 */

const STORAGE_KEY = 'box_cricket_3d_config_v4';

export const DIFFICULTY_PROFILES = {
  easy: {
    id: 'easy',
    nameEn: 'Easy',
    nameHi: 'आसान (Easy)',
    chaseTargetMin: 20,
    chaseTargetMax: 30,
    deliveryVarietyCount: 4,
    rareChanges: true,
    changeProbability: 0.30,
    bowlerAccuracy: 'low',
    accuracyScatterX: 0.24,
    accuracyScatterZ: 1.10,
    paceMinKmh: 90,
    paceMaxKmh: 118,
    swingTurnScale: 0.45,
    lateMovement: false,
    timingWindowMs: { perfect: 100, good: 180, mistime: 280 },
    fielderCatchSkill: 0.64,
    fielderSpeedMultiplier: 0.86,
    deliveryPreview: 'always', // 'always' | 'briefly' | 'hidden'
    looseBallsPerOver: 2,
    battingAssist: 'full' // 'full' | 'light' | 'off'
  },
  medium: {
    id: 'medium',
    nameEn: 'Medium',
    nameHi: 'मध्यम (Medium)',
    chaseTargetMin: 40,
    chaseTargetMax: 60,
    deliveryVarietyCount: 12,
    rareChanges: false,
    changeProbability: 0.72,
    bowlerAccuracy: 'medium',
    accuracyScatterX: 0.12,
    accuracyScatterZ: 0.52,
    paceMinKmh: 108,
    paceMaxKmh: 136,
    swingTurnScale: 0.82,
    lateMovement: true,
    timingWindowMs: { perfect: 72, good: 138, mistime: 225 },
    fielderCatchSkill: 0.80,
    fielderSpeedMultiplier: 0.96,
    deliveryPreview: 'always',
    looseBallsPerOver: 1,
    battingAssist: 'light'
  },
  hard: {
    id: 'hard',
    nameEn: 'Hard',
    nameHi: 'कठिन (Hard)',
    chaseTargetMin: 61,
    chaseTargetMax: 100,
    deliveryVarietyCount: 22, // All 22 types with smart tactical set-ups
    rareChanges: false,
    changeProbability: 0.90,
    bowlerAccuracy: 'very_high',
    accuracyScatterX: 0.05,
    accuracyScatterZ: 0.24,
    paceMinKmh: 120,
    paceMaxKmh: 148,
    swingTurnScale: 1.08,
    lateMovement: true,
    timingWindowMs: { perfect: 52, good: 105, mistime: 180 },
    fielderCatchSkill: 0.90,
    fielderSpeedMultiplier: 1.03,
    deliveryPreview: 'briefly',
    looseBallsPerOver: 0,
    battingAssist: 'off'
  }
};

// Keep backward-compatible aliases for any legacy references
DIFFICULTY_PROFILES.rookie = DIFFICULTY_PROFILES.easy;
DIFFICULTY_PROFILES.club = DIFFICULTY_PROFILES.medium;
DIFFICULTY_PROFILES.pro = DIFFICULTY_PROFILES.hard;
DIFFICULTY_PROFILES.legend = DIFFICULTY_PROFILES.hard;

export function normalizeDifficultyKey(diff) {
  if (!diff) return 'medium';
  const d = String(diff).toLowerCase();
  if (d === 'easy' || d === 'rookie') return 'easy';
  if (d === 'medium' || d === 'club') return 'medium';
  if (d === 'hard' || d === 'pro' || d === 'legend') return 'hard';
  return 'medium';
}

export function getDifficultyProfile(diff) {
  return DIFFICULTY_PROFILES[normalizeDifficultyKey(diff)] || DIFFICULTY_PROFILES.medium;
}

/**
 * Generates a fresh random target score strictly inside the selected difficulty's range:
 * - Easy: 20 to 30 runs (5 overs) | 12 to 16 runs (1-Over Thriller)
 * - Medium: 40 to 60 runs (5 overs) | 16 to 22 runs (1-Over Thriller)
 * - Hard: 61 to 100 runs (5 overs) | 22 to 28 runs (1-Over Thriller)
 */
export function rollRunChaseTarget(diff = gameConfig.difficulty, modeId = gameConfig.modeId) {
  const normDiff = normalizeDifficultyKey(diff);
  if (modeId === 'last_over') {
    const thrillerRanges = {
      easy: [12, 16],
      medium: [16, 22],
      hard: [22, 28]
    };
    const [minT, maxT] = thrillerRanges[normDiff] || thrillerRanges.medium;
    return Math.floor(Math.random() * (maxT - minT + 1)) + minT;
  }
  const profile = getDifficultyProfile(normDiff);
  const min = profile.chaseTargetMin || 40;
  const max = profile.chaseTargetMax || 60;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const DEFAULT_GAME_CONFIG = {
  // Mode, Difficulty, Stadium & Time of Day
  modeId: 'run_chase', // 'run_chase' (5 overs) | 'last_over' (1 over thriller) | 't20' (20 overs + toss)
  difficulty: 'medium', // 'easy' | 'medium' | 'hard'
  stadium: 'eden_gardens', // 'eden_gardens' | 'wankhede' | 'narendra_modi'
  timeOfDay: 'night', // 'day' | 'night'
  handedness: 'right',
  sensitivity: 1.0,
  bowlingAssist: 'off',
  autoBowl: 'normal', // 'fast' (1.3s) | 'normal' (2.1s) | 'manual' (wait for button)
  replays: 'default',
  uiSize: 'medium',
  graphicsQuality: 'high',
  dofEnabled: true,

  // Audio Mixer (0.0 to 1.0)
  audio: {
    muted: false,
    master: 0.85,
    effects: 0.90,
    crowd: 0.75,
    music: 0.45,
    commentary: 0.85
  },

  // Commentary Settings
  commentary: {
    enabled: true, // Visual text captions on screen
    spoken: true, // Spoken voice & Web Audio commentary cadence (independent of captions!)
    language: 'en', // 'en' | 'hi' | 'hinglish'
    voiceURI: 'auto',
    volume: 0.85,
    frequency: 'normal' // 'minimal' | 'normal' | 'full'
  }
};

export const gameConfig = structuredClone(DEFAULT_GAME_CONFIG);

export function loadGameConfig() {
  try {
    const raw = window.localStorage ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.modeId && ['run_chase', 'last_over', 't20'].includes(parsed.modeId)) {
          gameConfig.modeId = parsed.modeId;
        }
        if (parsed.difficulty) gameConfig.difficulty = normalizeDifficultyKey(parsed.difficulty);
        if (parsed.stadium && ['eden_gardens', 'wankhede', 'narendra_modi'].includes(parsed.stadium)) {
          gameConfig.stadium = parsed.stadium;
        }
        if (parsed.timeOfDay && ['day', 'night'].includes(parsed.timeOfDay)) {
          gameConfig.timeOfDay = parsed.timeOfDay;
        }
        if (parsed.handedness) gameConfig.handedness = parsed.handedness === 'left' ? 'left' : 'right';
        if (typeof parsed.sensitivity === 'number') gameConfig.sensitivity = parsed.sensitivity;
        if (parsed.bowlingAssist) gameConfig.bowlingAssist = parsed.bowlingAssist;
        if (parsed.autoBowl && ['fast', 'normal'].includes(parsed.autoBowl)) {
          gameConfig.autoBowl = parsed.autoBowl;
        } else {
          gameConfig.autoBowl = 'normal';
        }
        if (parsed.replays) gameConfig.replays = parsed.replays;
        if (parsed.uiSize) gameConfig.uiSize = parsed.uiSize;
        if (parsed.graphicsQuality) gameConfig.graphicsQuality = parsed.graphicsQuality;
        if (typeof parsed.dofEnabled === 'boolean') gameConfig.dofEnabled = parsed.dofEnabled;

        if (parsed.audio && typeof parsed.audio === 'object') {
          Object.assign(gameConfig.audio, parsed.audio);
        }
        if (parsed.commentary && typeof parsed.commentary === 'object') {
          Object.assign(gameConfig.commentary, parsed.commentary);
        }
      }
    }
  } catch {
    // Ignore storage read errors in restricted environments
  }
  return gameConfig;
}

export function saveGameConfig() {
  try {
    if (window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(gameConfig));
    }
  } catch {
    // Ignore storage write errors
  }
}

loadGameConfig();
