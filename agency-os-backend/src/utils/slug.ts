export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function generateProjectSlug(name: string, city: string, state: string): string {
  const base = `${name}-${city}-${state.slice(0, 2)}`;
  return slugify(base).slice(0, 60);
}
