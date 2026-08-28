/**
 * GitHubBackend - GitHub synchronization backend
 */

import type { Octokit } from '@octokit/rest';
import { BaseSyncBackend, RemoteFile } from './SyncBackend';
import { Manifest } from '../models/Manifest';
import { Change } from '../models/Change';
import { RemoteChange } from '../models/SyncResult';
import { Logger } from '../utils/logger';
import { SecureCredentialStore } from '../crypto/SecureCredentialStore';
import { normalizePath } from '../utils/pathUtils';

interface GitHubConfig {
  enabled: boolean;
  repository: string; // "owner/repo"
  branch: string;
  syncPath: string;
  authMethod: 'token' | 'oauth';
  personalAccessToken?: string;
  commitMessageTemplate: string;
  pushIntervalMinutes: number;
  pullBeforePush: boolean;
  createPrForConflicts: boolean;
}

interface GitHubTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

// Lazy loader for @octokit/rest - never executes top-level code during plugin load
let octokitPromise: Promise<typeof import('@octokit/rest')> | null = null;
function getOctokit(): Promise<typeof import('@octokit/rest')> {
  octokitPromise ||= import('@octokit/rest');
  return octokitPromise;
}

export class GitHubBackend extends BaseSyncBackend {
  private octokit: Octokit | null = null;
  private credentialStore: SecureCredentialStore;
  private owner = '';
  private repo = '';
  private treeCache: Map<string, GitHubTreeItem> = new Map();

  constructor(config: GitHubConfig, logger: Logger, credentialStore: SecureCredentialStore) {
    super(config, logger);
    this.credentialStore = credentialStore;
    
    if (config.repository) {
      const [owner, repo] = config.repository.split('/');
      this.owner = owner;
      this.repo = repo;
    }
  }

  getId(): string {
    return 'github';
  }

  getName(): string {
    return 'GitHub';
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    
    this.logger.info('Connecting to GitHub...');
    
    // Get token from secure storage
    let token = this.config.personalAccessToken;
    if (!token) {
      token = await this.credentialStore.get('github_token');
    }
    
    if (!token) {
      throw new Error('GitHub authentication token not configured');
    }
    
    const { Octokit } = await getOctokit();
    this.octokit = new Octokit({
      auth: token,
      userAgent: 'Nexavault/1.0.0',
    });
    
    // Test connection
    try {
      await this.octokit.rest.repos.get({ owner: this.owner, repo: this.repo });
      this.connected = true;
      this.logger.info('GitHub connected successfully');
    } catch (error: any) {
      if (error.status === 401 || error.status === 403) {
        throw new Error('GitHub authentication failed. Check your token and repository permissions.');
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.octokit = null;
    this.connected = false;
    this.treeCache.clear();
    this.logger.info('GitHub disconnected');
  }

  async testConnection(): Promise<boolean> {
    if (!this.octokit) return false;
    
    try {
      await this.octokit.rest.repos.get({ owner: this.owner, repo: this.repo });
      return true;
    } catch {
      return false;
    }
  }

  async getRemoteManifest(): Promise<Manifest> {
    if (!this.octokit) throw new Error('Not connected');
    
    this.logger.debug('Fetching GitHub manifest...');
    
    try {
      // Get tree recursively
      const tree = await this.getTreeRecursive(this.config.branch, this.config.syncPath);
      
      const files: Manifest['files'] = {};
      
      for (const item of tree) {
        if (item.type === 'blob') {
          const relativePath = normalizePath(item.path.replace(this.config.syncPath + '/', ''));
          if (relativePath) {
            // Get file content to compute hash
            const content = await this.downloadFile(item.path);
            const hash = await this.computeHash(content);
            
            files[relativePath] = {
              hash,
              size: item.size || content.length,
              mtime: Date.now(), // GitHub doesn't provide mtime easily
            };
          }
        }
      }
      
      return {
        version: 1,
        generatedAt: Date.now(),
        deviceId: 'github',
        files,
        metadata: {
          totalFiles: Object.keys(files).length,
          totalSize: Object.values(files).reduce((sum, f) => sum + f.size, 0),
          schemaVersion: 1,
        },
      };
    } catch (error) {
      this.logger.error('Failed to get GitHub manifest', error);
      throw error;
    }
  }

  async uploadFile(path: string, data: Uint8Array): Promise<{ etag?: string; versionId?: string }> {
    if (!this.octokit) throw new Error('Not connected');
    
    const fullPath = this.getFullPath(path);
    const content = Buffer.from(data).toString('base64');
    
    try {
      // Check if file exists
      let sha: string | undefined;
      try {
        const existing = await this.octokit.rest.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path: fullPath,
          ref: this.config.branch,
        });
        if ('sha' in existing.data) {
          sha = existing.data.sha;
        }
      } catch (error: any) {
        if (error.status !== 404) throw error;
      }
      
      await this.octokit.rest.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path: fullPath,
        message: `vault: update ${path}`,
        content,
        branch: this.config.branch,
        sha,
      });
      
      return { etag: sha };
    } catch (error) {
      this.logger.error(`Failed to upload ${path}`, error);
      throw error;
    }
  }

  async downloadFile(path: string): Promise<Uint8Array> {
    if (!this.octokit) throw new Error('Not connected');
    
    const fullPath = this.getFullPath(path);
    
    try {
      const response = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: fullPath,
        ref: this.config.branch,
      });
      
      if ('content' in response.data) {
        const content = response.data.content;
        const encoding = response.data.encoding;
        
        if (encoding === 'base64') {
          const binary = atob(content);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          return bytes;
        }
      }
      
      throw new Error('Unexpected response format');
    } catch (error: any) {
      if (error.status === 404) {
        throw new Error(`File not found: ${path}`);
      }
      throw error;
    }
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.octokit) throw new Error('Not connected');
    
    const fullPath = this.getFullPath(path);
    
    try {
      // Get current SHA
      const existing = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: fullPath,
        ref: this.config.branch,
      });
      
      if ('sha' in existing.data) {
        await this.octokit.rest.repos.deleteFile({
          owner: this.owner,
          repo: this.repo,
          path: fullPath,
          message: `vault: delete ${path}`,
          sha: existing.data.sha,
          branch: this.config.branch,
        });
      }
    } catch (error: any) {
      if (error.status !== 404) throw error;
    }
  }

  async listFiles(prefix?: string): Promise<RemoteFile[]> {
    if (!this.octokit) throw new Error('Not connected');
    
    const path = prefix ? this.getFullPath(prefix) : this.config.syncPath;
    const tree = await this.getTreeRecursive(this.config.branch, path);
    
    return tree
      .filter(item => item.type === 'blob')
      .map(item => ({
        path: normalizePath(item.path.replace(this.config.syncPath + '/', '')),
        size: item.size || 0,
        mtime: Date.now(),
        etag: item.sha,
      }));
  }

  async pushChanges(changes: Change[]): Promise<void> {
    if (!this.octokit) throw new Error('Not connected');
    if (changes.length === 0) return;
    
    this.logger.info(`Pushing ${changes.length} changes to GitHub...`);
    
    // Create a tree with all changes
    const treeItems = [];
    
    for (const change of changes) {
      const fullPath = this.getFullPath(change.path);
      
      if (change.type === 'delete') {
        treeItems.push({
          path: fullPath,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: null as any,
        });
      } else {
        // Read file content
        const data = await this.readLocalFile(change.path);
        const content = Buffer.from(data).toString('base64');
        
        // Create blob
        const blob = await this.octokit.rest.git.createBlob({
          owner: this.owner,
          repo: this.repo,
          content,
          encoding: 'base64',
        });
        
        treeItems.push({
          path: fullPath,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: blob.data.sha,
        });
      }
    }
    
    // Get base tree
    const baseCommit = await this.octokit.rest.repos.getCommit({
      owner: this.owner,
      repo: this.repo,
      ref: this.config.branch,
    });
    
    const baseTree = baseCommit.data.commit.tree.sha;
    
    // Create new tree
    const newTree = await this.octokit.rest.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: baseTree,
      tree: treeItems,
    });
    
    // Create commit
    const commitMessage = this.formatCommitMessage(changes);
    const commit = await this.octokit.rest.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: commitMessage,
      tree: newTree.data.sha,
      parents: [baseCommit.data.sha],
    });
    
    // Update branch reference
    await this.octokit.rest.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${this.config.branch}`,
      sha: commit.data.sha,
      force: false,
    });
    
    this.logger.info(`GitHub push successful: ${commit.data.sha}`);
  }

  async pullChanges(): Promise<RemoteChange[]> {
    // For GitHub, we'd compare manifests and return changes
    // This is simplified - real implementation would fetch diff
    return [];
  }

  private async getTreeRecursive(branch: string, path: string): Promise<GitHubTreeItem[]> {
    const cacheKey = `${branch}:${path}`;
    if (this.treeCache.has(cacheKey)) {
      return Array.from(this.treeCache.values());
    }
    
    const response = await this.octokit!.rest.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: (await this.getBranchCommitSha(branch)).sha,
      recursive: '1',
    });
    
    const items = response.data.tree || [];
    
    // Filter by path prefix
    const filtered = items.filter(item => item.path && item.path.startsWith(path));
    
    for (const item of filtered) {
      if (item.path) {
        this.treeCache.set(`${branch}:${item.path}`, item as GitHubTreeItem);
      }
    }
    
    return filtered as GitHubTreeItem[];
  }

  private async getBranchCommitSha(branch: string): Promise<{ sha: string }> {
    const response = await this.octokit!.rest.repos.getBranch({
      owner: this.owner,
      repo: this.repo,
      branch,
    });
    return { sha: response.data.commit.sha };
  }

  private getFullPath(path: string): string {
    const base = this.config.syncPath || 'vault';
    return normalizePath(`${base}/${path}`);
  }

  private formatCommitMessage(changes: Change[]): string {
    const template = this.config.commitMessageTemplate || 'vault: sync {count} files ({action})';
    const counts = {
      create: changes.filter(c => c.type === 'create').length,
      modify: changes.filter(c => c.type === 'modify').length,
      delete: changes.filter(c => c.type === 'delete').length,
      rename: changes.filter(c => c.type === 'rename').length,
    };
    
    const actions = [];
    if (counts.create) actions.push(`${counts.create} created`);
    if (counts.modify) actions.push(`${counts.modify} modified`);
    if (counts.delete) actions.push(`${counts.delete} deleted`);
    if (counts.rename) actions.push(`${counts.rename} renamed`);
    
    return template
      .replace('{count}', changes.length.toString())
      .replace('{action}', actions.join(', '))
      .replace('{create}', counts.create.toString())
      .replace('{modify}', counts.modify.toString())
      .replace('{delete}', counts.delete.toString())
      .replace('{rename}', counts.rename.toString());
  }

  private async readLocalFile(path: string): Promise<Uint8Array> {
    // This would be injected via the SyncEngine
    // For now, return empty - the SyncEngine handles file reading
    return new Uint8Array();
  }

  private async computeHash(data: Uint8Array): Promise<string> {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  getCapabilities() {
    return {
      supportsVersioning: true,
      supportsMultipart: false,
      maxFileSize: 100 * 1024 * 1024, // 100MB GitHub limit
      maxPartSize: 100 * 1024 * 1024,
      supportsEncryption: false,
      supportsRename: true,
      supportsBatchOperations: true,
    };
  }
}
