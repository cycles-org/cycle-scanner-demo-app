// Toggle between dark and light themes — affects both the FintaChart theme
// and the page chrome (CSS variables on body[data-theme]).

export default function ThemeToggle({ theme, onChange }) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      className="theme-toggle"
      title={`switch to ${next} theme`}
      onClick={() => onChange(next)}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
