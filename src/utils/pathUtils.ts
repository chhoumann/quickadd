export function basenameWithoutMdOrCanvas(path: string): string {
  const base = path.split('/').pop() ?? '';
  return base.replace(/\.(md|canvas)$/i, '');
}

