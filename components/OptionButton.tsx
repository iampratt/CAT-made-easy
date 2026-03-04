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
      className={`card option-btn ${selected ? 'active' : ''}`}
    >
      {option}
    </button>
  );
}
