// Gear icon in the main toolbar — opens the settings dialog. Pairs with
// SettingsDialog.jsx (mounted once at App root).

import { useSettingsStore } from '../state/useSettingsStore.js';

export default function SettingsButton() {
  const openSettings = useSettingsStore((s) => s.openSettings);
  return (
    <button
      className="settings-btn"
      title="settings · lookback / projection / lazy-load"
      aria-label="open settings"
      onClick={openSettings}
    >
      ⚙
    </button>
  );
}
