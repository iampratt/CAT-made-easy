import { randomUUID } from 'node:crypto';

export function groupDilrSets(pageText: string) {
  const setId = randomUUID();
  return [
    {
      setId,
      setText: pageText,
      questions: pageText.split(/\n(?=\d+\.)/g).filter(Boolean),
    },
  ];
}
