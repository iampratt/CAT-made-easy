import { clsx } from 'clsx';

export function cn(...args: Array<string | undefined | false>) {
  return clsx(args);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
