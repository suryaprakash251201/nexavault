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
  private fileReader: ((path: string) => Promise<Uint8Array>) | null = null;
  private emptyRepo = false;

  /**
   * Inject a vault file reader (wired by SyncEngine).
   * Never uploads silently-empty files: without a reader, pushes throw.
   */
  setFileReader(reader: (path: string) => Promise<Uint8Array>): void {
    this.fileReader = reader;
  }

  constructor(config: GitHubConfig, logger: Logger, credentialStore: SecureCredentialStore) {
    super(config, logger);
    this.credentialStore = credentialStore;
    
    if (config.repository) {
      const [owner, repo] = config.repository.split('/');
      this.owner = owner;
      this.repo = repo;
    }
  }

  override updateConfig(config: any): void {
    super.updateConfig(config);
    const [owner = '', repo = ''] = (config.repository || '').split('/');
    this.owner = owner;
    this.repo = repo;
    this.treeCache.clear();
    if (this.connected) {
      this.connected = false; // force reconnect with new config
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

    // Validate configuration first (clear errors instead of cryptic API errors)
    if (!this.owner || !this.repo) {
      throw new Error('GitHub repository not configured. Set it as "owner/repo" in NexaVault settings.');
    }

    // Get token from secure storage
    let token = this.config.personalAccessToken;
    if (!token) {
      token = await this.credentialStore.get('github_token');
    }

    if (!token) {
      throw new Error('GitHub authentication token not configured. Paste a Personal Access Token in NexaVault settings.');
    }

    const { Octokit } = await getOctokit();
    this.octokit = new Octokit({
      auth: token,
      userAgent: 'NexaVault/1.0.0',
    });

    // Test connection
    this.emptyRepo = false;
    try {
      await this.octokit.rest.repos.get({ owner: this.owner, repo: this.repo });

      // Detect empty repos (no commits): branch ref does not exist yet.
      try {
        const branches = await this.octokit.rest.repos.listBranches({
          owner: this.owner, repo: this.repo, per_page: 1,
        });
        this.emptyRepo = branches.data.length === 0;
      } catch {
        this.emptyRepo = false;
      }
      if (this.emptyRepo) {
        this.logger.warn('Repository is empty (no commits). First sync will create the initial commit automatically.');
      }

      this.connected = true;
      this.logger.info('GitHub connected successfully');
    } catch (error: any) {
      if (error.status === 401 || error.status === 403) {
        throw new Error('GitHub authentication failed. Check your token and repository permissions.');
      }
      if (error.status === 404) {
        throw new Error(`Repository "${this.owner}/${this.repo}" not found or no access. For private repos, your token must have the "repo" scope.`);
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
      // Get tree recursively (empty repo / no branch -> empty manifest)
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

  private static readonly MAX_BLOB_SIZE = 100 * 1024 * 1024; // GitHub blob limit

  /**
   * Map GitHub API errors to precise, actionable messages
   */
  private mapApiError(error: any): Error {
    const status = error?.status ?? error?.response?.status;
    // Rate limiting: 403 with exhausted quota, or 429
    const remaining = error?.response?.headers?.['x-ratelimit-remaining'];
    if (status === 403 && remaining === '0') {
      return new Error('GitHub API rate limit exceeded. Wait for the rate window to reset (check x-ratelimit-reset), or sync again later.');
    }
    if (status === 429) {
      return new Error('GitHub API rate limited (429). NexaVault will retry after the backoff period.');
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  async pushChanges(changes: Change[]): Promise<void> {
    if (!this.octokit) throw new Error('Not connected');
    if (changes.length === 0) return;

    this.logger.info(`Pushing ${changes.length} changes to GitHub...`);

    try {

    // Cache invalidation: after any successful push the remote tree changed,
    // so the treeCache (used by getRemoteManifest) must be cleared.
    const invalidateAfter = () => { this.treeCache.clear(); };

    // Empty repo: GitHub's git-DB API refuses (409 "Git Repository is empty").
    // Use the Contents API instead - the first write creates the initial
    // commit AND the branch automatically.
    if (this.emptyRepo) {
      this.logger.info('Empty repository detected - bootstrapping via Contents API');
      for (const change of changes) {
        if (change.type === 'delete') {
          await this.deleteFile(change.path);
          continue;
        }
        if (change.type === 'rename' && change.oldPath) {
          await this.deleteFile(change.oldPath);
          if (!this.fileReader) {
            throw new Error('GitHub backend has no file reader - file upload disabled');
          }
          const data = await this.fileReader(change.path);
          await this.uploadFile(change.path, data);
          continue;
        }
        if (!this.fileReader) {
          throw new Error('GitHub backend has no file reader - file upload disabled');
        }
        const data = await this.fileReader(change.path);
        await this.uploadFile(change.path, data);
      }
      this.emptyRepo = false;
      invalidateAfter();
      this.logger.info('Bootstrap push complete - branch and initial commits created');
      return;
    }

    // Create a tree with all changes
    const treeItems = [];
    
    for (const change of changes) {
      // Renames also remove the old path
      if (change.type === 'rename' && change.oldPath) {
        treeItems.push({
          path: this.getFullPath(change.oldPath),
          mode: '100644' as const,
          type: 'blob' as const,
          sha: null as any,
        });
      }

      const fullPath = this.getFullPath(change.path);

      if (change.type === 'delete') {
        treeItems.push({
          path: fullPath,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: null as any,
        });
      } else {
        // Read file content through the injected vault reader
        if (!this.fileReader) {
          throw new Error('GitHub backend has no file reader - file upload disabled');
        }
        const data = await this.fileReader(change.path);

        // GitHub blob API limit is 100 MB - fail clearly instead of a 422 batch failure
        if (data.length > GitHubBackend.MAX_BLOB_SIZE) {
          throw new Error(`GitHub file too large (${(data.length / 1024 / 1024).toFixed(1)} MB, limit 100 MB): ${change.path}`);
        }

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
    
    // Determine base commit/tree (empty repos have none yet)
    let baseCommitSha: string | null = null;
    let baseTreeSha: string | null = null;
    if (!this.emptyRepo) {
      try {
        const baseCommit = await this.octokit.rest.repos.getCommit({
          owner: this.owner,
          repo: this.repo,
          ref: this.config.branch,
        });
        baseCommitSha = baseCommit.data.sha;
        baseTreeSha = baseCommit.data.commit.tree.sha;
      } catch (error: any) {
        if (error.status === 404) {
          this.emptyRepo = true; // branch not created yet
        } else {
          throw error;
        }
      }
    }

    // Create new tree (no base_tree for the very first commit)
    const newTree = await this.octokit.rest.git.createTree({
      owner: this.owner,
      repo: this.repo,
      ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
      tree: treeItems,
    });

    // Create commit
    const commitMessage = this.formatCommitMessage(changes);
    const commit = await this.octokit.rest.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: commitMessage,
      tree: newTree.data.sha,
      parents: baseCommitSha ? [baseCommitSha] : [],
    });

    if (this.emptyRepo) {
      // First commit ever: create the branch ref
      await this.octokit.rest.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${this.config.branch}`,
        sha: commit.data.sha,
      });
      this.emptyRepo = false;
    } else {
      // Update branch reference
      await this.octokit.rest.git.updateRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${this.config.branch}`,
        sha: commit.data.sha,
        force: false,
      });
    }

    invalidateAfter();
    this.logger.info(`GitHub push successful: ${commit.data.sha}`);
    } catch (error) {
      throw this.mapApiError(error);
    }
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

    let commitSha: string;
    try {
      commitSha = (await this.getBranchCommitSha(branch)).sha;
    } catch (error: any) {
      if (error.status === 404) {
        return []; // branch/commit does not exist yet (empty repo)
      }
      throw error;
    }

    const response = await this.octokit!.rest.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: commitSha,
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

  // File reading is delegated to the vault reader injected via setFileReader

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
