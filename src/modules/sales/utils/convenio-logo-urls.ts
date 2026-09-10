const raw = import.meta.glob('../assets/convenio/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const BY_FILE: Record<string, string> = {};
for (const [path, url] of Object.entries(raw)) {
  const name = path.replace(/\\/g, '/').split('/').pop();
  if (name) BY_FILE[name] = url;
}

export function convenioLogoUrl(file: string): string | null {
  return BY_FILE[file] || null;
}
