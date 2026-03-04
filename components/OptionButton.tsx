'use client';

interface Props {
  option: string;
  selected?: boolean;
  onClick: () => void;
}

export function OptionButton({ option, selected, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card"
      style={{
        textAlign: 'left',
        borderColor: selected ? 'var(--primary)' : 'var(--border)',
        boxShadow: selected ? '0 0 0 1px var(--primary) inset' : 'none',
      }}
    >
      {option}
    </button>
  );
}
