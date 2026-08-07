interface HelpButtonProps {
  onClick: () => void;
}

/** Header button that opens the controls help overlay. */
export function HelpButton({ onClick }: HelpButtonProps) {
  return (
    <button
      type="button"
      className="help-button"
      onClick={onClick}
      aria-label="Open controls help"
      title="Controls help"
    >
      ?
    </button>
  );
}
