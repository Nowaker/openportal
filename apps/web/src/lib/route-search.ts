export function withServerSearch<T extends object>(search: T, server: string) {
  return { ...search, server };
}
