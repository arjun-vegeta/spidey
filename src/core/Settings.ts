export interface SettingsData {
  sensitivity: number;
  volume: number;
  fov: number;
  minimap: boolean;
  quality: 'high' | 'low';
  muted: boolean;
}

const KEY = 'spidey-settings-v1';

export const defaultSettings: SettingsData = {
  sensitivity: 0.8, // 0.80x tuned for trackpad precision without over-rotation
  volume: 0.7,
  fov: 75,
  minimap: true,
  quality: 'high',
  muted: false,
};

export function loadSettings(): SettingsData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw) as Partial<SettingsData>;
    return {
      sensitivity: clampNum(parsed.sensitivity, 0.5, 2.0, defaultSettings.sensitivity),
      volume: clampNum(parsed.volume, 0, 1, defaultSettings.volume),
      fov: clampNum(parsed.fov, 70, 90, defaultSettings.fov),
      minimap: typeof parsed.minimap === 'boolean' ? parsed.minimap : defaultSettings.minimap,
      quality: parsed.quality === 'low' ? 'low' : 'high',
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : defaultSettings.muted,
    };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(s: SettingsData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode etc: settings simply don't persist.
  }
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}
