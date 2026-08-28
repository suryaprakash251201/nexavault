/**
 * Path utilities for cross-platform path handling
 */

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(p => p).join('/'));
}

export function getDirname(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) return '';
  return normalized.substring(0, lastSlash);
}

export function getBasename(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  return normalized.substring(lastSlash + 1);
}

export function getExtension(path: string): string {
  const basename = getBasename(path);
  const lastDot = basename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return basename.substring(lastDot + 1).toLowerCase();
}

export function isSubPath(child: string, parent: string): boolean {
  const normalizedChild = normalizePath(child);
  const normalizedParent = normalizePath(parent);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(normalizedParent + '/');
}

export function relativePath(from: string, to: string): string {
  const fromParts = normalizePath(from).split('/').filter(p => p);
  const toParts = normalizePath(to).split('/').filter(p => p);
  
  let commonLength = 0;
  while (commonLength < fromParts.length && commonLength < toParts.length && 
         fromParts[commonLength] === toParts[commonLength]) {
    commonLength++;
  }
  
  const upCount = fromParts.length - commonLength;
  const upPath = '../'.repeat(upCount);
  const downPath = toParts.slice(commonLength).join('/');
  
  return upPath + downPath;
}

export function matchGlob(pattern: string, path: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedPattern = normalizePath(pattern);
  
  // Convert glob to regex
  const regexPattern = normalizedPattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(normalizedPath);
}

export function matchAnyGlob(patterns: string[], path: string): boolean {
  return patterns.some(pattern => matchGlob(pattern, path));
}

export function sanitizePath(path: string): string {
  // Prevent path traversal
  const normalized = normalizePath(path);
  const parts = normalized.split('/').filter(p => p && p !== '.');
  const result: string[] = [];
  
  for (const part of parts) {
    if (part === '..') {
      if (result.length > 0) {
        result.pop();
      }
    } else {
      result.push(part);
    }
  }
  
  return result.join('/');
}

export function isValidPath(path: string): boolean {
  const normalized = normalizePath(path);
  // Check for path traversal attempts
  if (normalized.includes('..')) return false;
  // Check for absolute paths
  if (normalized.startsWith('/')) return false;
  // Check for empty
  if (!normalized) return false;
  return true;
}
