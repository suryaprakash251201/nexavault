/**
 * SettingsTab - Comprehensive settings UI
 */

import { PluginSettingTab, Setting, Notice } from 'obsidian';
import { Logger } from '../utils/logger';
import { getProvider, getProviderConfigs } from '../providers';
import { SecureCredentialStore } from '../crypto/SecureCredentialStore';

export class VaultSyncSettingTab extends PluginSettingTab {
  plugin: any;
  private logger: Logger;
  private credentialStore: SecureCredentialStore;

  constructor(app: any, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
    this.logger = plugin.getLogger();
    this.credentialStore = plugin.getCredentialStore()!;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('nexavault-settings');
    
    this.createGeneralSettings(containerEl);
    this.createGitHubSettings(containerEl);
    this.createS3Settings(containerEl);
    this.createEncryptionSettings(containerEl);
    this.createExclusionSettings(containerEl);
    this.createAdvancedSettings(containerEl);
  }

  private createGeneralSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'General' });
    
    new Setting(containerEl)
      .setName('Enable Nexavault')
      .setDesc('Enable or disable the entire plugin')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.general.enabled)
        .onChange(async (value) => {
          this.plugin.settings.general.enabled = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Automatic Sync')
      .setDesc('Automatically sync when files change')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.general.autoSync)
        .onChange(async (value) => {
          this.plugin.settings.general.autoSync = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Debounce Period')
      .setDesc('Time to wait before syncing after a change (milliseconds)')
      .addSlider(slider => slider
        .setLimits(500, 10000, 500)
        .setValue(this.plugin.settings.general.debounceMs)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.general.debounceMs = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Sync on Startup')
      .setDesc('Perform a full sync when Obsidian starts')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.general.syncOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.general.syncOnStartup = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Sync on Network Reconnect')
      .setDesc('Sync when network connection is restored')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.general.syncOnNetworkReconnect)
        .onChange(async (value) => {
          this.plugin.settings.general.syncOnNetworkReconnect = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Periodic Sync')
      .setDesc('Enable periodic full sync')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.general.periodicSyncEnabled)
        .onChange(async (value) => {
          this.plugin.settings.general.periodicSyncEnabled = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Periodic Sync Interval')
      .setDesc('Minutes between periodic syncs')
      .addSlider(slider => slider
        .setLimits(5, 1440, 5)
        .setValue(this.plugin.settings.general.periodicSyncIntervalMinutes)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.general.periodicSyncIntervalMinutes = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Max Concurrent Operations')
      .setDesc('Maximum simultaneous upload/download operations')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(this.plugin.settings.general.maxConcurrentOperations)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.general.maxConcurrentOperations = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Large File Threshold')
      .setDesc('Files larger than this (MB) will show warnings')
      .addSlider(slider => slider
        .setLimits(10, 1000, 10)
        .setValue(this.plugin.settings.general.largeFileThresholdMB)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.general.largeFileThresholdMB = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Show Notifications')
      .setDesc('Show sync notifications')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.general.showNotifications)
        .onChange(async (value) => {
          this.plugin.settings.general.showNotifications = value;
          await this.plugin.saveSettings();
        }));
  }

  private createGitHubSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'GitHub Live Sync' });
    
    new Setting(containerEl)
      .setName('Enable GitHub Sync')
      .setDesc('Enable synchronization with GitHub')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.github.enabled)
        .onChange(async (value) => {
          this.plugin.settings.github.enabled = value;
          await this.plugin.saveSettings();
          this.display(); // Refresh to show/hide settings
        }));
    
    if (!this.plugin.settings.github.enabled) return;
    
    new Setting(containerEl)
      .setName('Repository')
      .setDesc('GitHub repository in format "owner/repo"')
      .addText(text => text
        .setPlaceholder('owner/repo')
        .setValue(this.plugin.settings.github.repository)
        .onChange(async (value) => {
          this.plugin.settings.github.repository = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Branch')
      .setDesc('Branch to sync with')
      .addText(text => text
        .setPlaceholder('main')
        .setValue(this.plugin.settings.github.branch)
        .onChange(async (value) => {
          this.plugin.settings.github.branch = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Sync Path')
      .setDesc('Path within the repository')
      .addText(text => text
        .setPlaceholder('vault')
        .setValue(this.plugin.settings.github.syncPath)
        .onChange(async (value) => {
          this.plugin.settings.github.syncPath = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Authentication Method')
      .setDesc('How to authenticate with GitHub')
      .addDropdown(dropdown => dropdown
        .addOption('token', 'Personal Access Token')
        .addOption('oauth', 'OAuth (not implemented)')
        .setValue(this.plugin.settings.github.authMethod)
        .onChange(async (value) => {
          this.plugin.settings.github.authMethod = value as any;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Personal Access Token')
      .setDesc('GitHub PAT with repo permissions (stored securely)')
      .addText(text => {
        text.setPlaceholder('ghp_************')
          .setValue('')
          .onChange(async (value) => {
            if (value) {
              await this.credentialStore.set('github_token', value);
              this.plugin.settings.github.personalAccessToken = value;
              await this.plugin.saveSettings();
              text.setPlaceholder('•••••••• (saved)');
            }
          });
        // Show a hint if a token is already stored
        this.credentialStore.get('github_token').then(v => {
          if (v) text.setPlaceholder('•••••••• (saved)');
        });
        return text;
      });
    
    // Test connection button
    new Setting(containerEl)
      .setName('Test Connection')
      .setDesc('Verify GitHub credentials and repository access')
      .addButton(btn => btn
        .setButtonText('Test')
        .setCta()
        .onClick(async () => {
          try {
            const backend = this.plugin.getSyncEngine()?.githubBackend;
            if (backend) {
              await backend.connect();
              const ok = await backend.testConnection();
              new Notice(ok ? 'GitHub connection successful!' : 'GitHub connection failed');
              await backend.disconnect();
            } else {
              new Notice('GitHub backend not initialized');
            }
          } catch (error) {
            new Notice(`GitHub connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }));
    
    new Setting(containerEl)
      .setName('Commit Message Template')
      .setDesc('Template for commit messages. Variables: {count}, {action}, {create}, {modify}, {delete}, {rename}')
      .addText(text => text
        .setPlaceholder('nexavault: sync {count} files ({action})')
        .setValue(this.plugin.settings.github.commitMessageTemplate)
        .onChange(async (value) => {
          this.plugin.settings.github.commitMessageTemplate = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Push Interval')
      .setDesc('Minutes between automatic pushes')
      .addSlider(slider => slider
        .setLimits(1, 60, 1)
        .setValue(this.plugin.settings.github.pushIntervalMinutes)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.github.pushIntervalMinutes = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Pull Before Push')
      .setDesc('Always pull remote changes before pushing')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.github.pullBeforePush)
        .onChange(async (value) => {
          this.plugin.settings.github.pullBeforePush = value;
          await this.plugin.saveSettings();
        }));
  }

  private createS3Settings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'S3-Compatible Backup' });
    
    new Setting(containerEl)
      .setName('Enable S3 Backup')
      .setDesc('Enable backup to S3-compatible storage')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.s3.enabled)
        .onChange(async (value) => {
          this.plugin.settings.s3.enabled = value;
          await this.plugin.saveSettings();
          this.display();
        }));
    
    if (!this.plugin.settings.s3.enabled) return;
    
    const providers = getProviderConfigs();
    
    new Setting(containerEl)
      .setName('Provider')
      .setDesc('S3-compatible storage provider')
      .addDropdown(dropdown => {
        for (const provider of providers) {
          dropdown.addOption(provider.type, provider.name);
        }
        dropdown.setValue(this.plugin.settings.s3.provider);
        dropdown.onChange(async (value) => {
          this.plugin.settings.s3.provider = value as any;
          // Update default settings for new provider
          const providerObj = getProvider(value as any);
          const defaults = providerObj.getDefaultSettings();
          this.plugin.settings.s3 = { ...this.plugin.settings.s3, ...defaults };
          await this.plugin.saveSettings();
          this.display();
        });
      });
    
    const provider = getProvider(this.plugin.settings.s3.provider);
    const config = provider.getConfig();
    
    new Setting(containerEl)
      .setName('Endpoint')
      .setDesc(`S3 endpoint URL (default: ${config.defaultEndpoint})`)
      .addText(text => text
        .setPlaceholder(config.defaultEndpoint)
        .setValue(this.plugin.settings.s3.endpoint)
        .onChange(async (value) => {
          this.plugin.settings.s3.endpoint = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Region')
      .setDesc(`AWS region (default: ${config.defaultRegion})`)
      .addText(text => text
        .setPlaceholder(config.defaultRegion)
        .setValue(this.plugin.settings.s3.region)
        .onChange(async (value) => {
          this.plugin.settings.s3.region = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Bucket')
      .setDesc('S3 bucket name')
      .addText(text => text
        .setPlaceholder('my-vault-backups')
        .setValue(this.plugin.settings.s3.bucket)
        .onChange(async (value) => {
          this.plugin.settings.s3.bucket = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Path Prefix')
      .setDesc('Prefix/path within the bucket')
      .addText(text => text
        .setPlaceholder('vault/')
        .setValue(this.plugin.settings.s3.prefix)
        .onChange(async (value) => {
          this.plugin.settings.s3.prefix = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Use Path-Style Addressing')
      .setDesc('Use endpoint/bucket/key format instead of bucket.endpoint/key. Required by MinIO and most non-AWS S3 services (CloudPE, Wasabi, custom endpoints).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.s3.forcePathStyle)
        .onChange(async (value) => {
          this.plugin.settings.s3.forcePathStyle = value;
          await this.plugin.saveSettings();
        }));
    
    // Credentials
    containerEl.createEl('h3', { text: 'Credentials', style: 'margin-top: 24px; margin-bottom: 12px;' });
    
    for (const field of config.credentialFields) {
      const key = field.key === 'keyId' ? 'accessKeyId' : 
                  field.key === 'applicationKey' ? 'secretAccessKey' : field.key;
      const credKey = `s3_${key}`;
      
      new Setting(containerEl)
        .setName(field.label)
        .setDesc(field.description || '')
        .addText(text => {
          text.setPlaceholder(field.placeholder || '')
            .setValue('')
            .onChange(async (value) => {
              if (value) {
                await this.credentialStore.set(credKey, value);
                text.setPlaceholder('•••••••• (saved)');
              }
            });
          // Show a hint if already stored (fields intentionally render blank)
          this.credentialStore.get(credKey).then(v => {
            if (v) text.setPlaceholder('•••••••• (saved)');
          });
          return text;
        });
    }
    
    // Test connection
    new Setting(containerEl)
      .setName('Test Connection')
      .setDesc('Verify S3 credentials and bucket access')
      .addButton(btn => btn
        .setButtonText('Test')
        .setCta()
        .onClick(async () => {
          try {
            const backend = this.plugin.getSyncEngine()?.s3Backend;
            if (backend) {
              await backend.connect();
              const ok = await backend.testConnection();
              new Notice(ok ? 'S3 connection successful!' : 'S3 connection failed');
              await backend.disconnect();
            } else {
              new Notice('S3 backend not initialized');
            }
          } catch (error) {
            new Notice(`S3 connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }));
    
    // Backup interval
    new Setting(containerEl)
      .setName('Backup Interval')
      .setDesc('Hours between automatic backups')
      .addSlider(slider => slider
        .setLimits(1, 168, 1)
        .setValue(this.plugin.settings.s3.backupIntervalHours)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.s3.backupIntervalHours = value;
          await this.plugin.saveSettings();
        }));
    
    // Retention
    containerEl.createEl('h3', { text: 'Retention Policy', style: 'margin-top: 24px; margin-bottom: 12px;' });
    
    new Setting(containerEl)
      .setName('Daily Backups to Keep')
      .addSlider(slider => slider
        .setLimits(0, 30, 1)
        .setValue(this.plugin.settings.s3.retention.daily)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.s3.retention.daily = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Weekly Backups to Keep')
      .addSlider(slider => slider
        .setLimits(0, 12, 1)
        .setValue(this.plugin.settings.s3.retention.weekly)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.s3.retention.weekly = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Monthly Backups to Keep')
      .addSlider(slider => slider
        .setLimits(0, 24, 1)
        .setValue(this.plugin.settings.s3.retention.monthly)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.s3.retention.monthly = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Max Total Backups')
      .addSlider(slider => slider
        .setLimits(10, 200, 10)
        .setValue(this.plugin.settings.s3.retention.maxTotalBackups)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.s3.retention.maxTotalBackups = value;
          await this.plugin.saveSettings();
        }));
    
    // Multipart
    containerEl.createEl('h3', { text: 'Multipart Upload', style: 'margin-top: 24px; margin-bottom: 12px;' });
    
    new Setting(containerEl)
      .setName('Multipart Threshold')
      .setDesc('Files larger than this (MB) use multipart upload')
      .addSlider(slider => slider
        .setLimits(10, 5000, 10)
        .setValue(this.plugin.settings.s3.multipartThresholdMB)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.s3.multipartThresholdMB = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Multipart Chunk Size')
      .setDesc('Size of each part (MB)')
      .addSlider(slider => slider
        .setLimits(5, 5000, 5)
        .setValue(this.plugin.settings.s3.multipartChunksizeMB)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.s3.multipartChunksizeMB = value;
          await this.plugin.saveSettings();
        }));
    
    // Setup instructions
    const instructionsEl = containerEl.createDiv({ cls: 'nexavault-setup-instructions' });
    instructionsEl.style.cssText = 'margin-top: 24px; padding: 16px; background: var(--background-secondary); border-radius: 6px; font-size: 12px; color: var(--text-muted);';
    instructionsEl.innerHTML = provider.getSetupInstructions().replace(/\n/g, '<br>');
  }

  private createEncryptionSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Encryption' });
    
    new Setting(containerEl)
      .setName('Enable Encryption')
      .setDesc('Encrypt backups client-side before uploading to S3')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.encryption.enabled)
        .onChange(async (value) => {
          this.plugin.settings.encryption.enabled = value;
          await this.plugin.saveSettings();
          this.display();
        }));
    
    if (!this.plugin.settings.encryption.enabled) return;
    
    new Setting(containerEl)
      .setName('Algorithm')
      .setDesc('Encryption algorithm')
      .addDropdown(dropdown => dropdown
        .addOption('aes-256-gcm', 'AES-256-GCM (recommended)')
        .addOption('chacha20-poly1305', 'ChaCha20-Poly1305')
        .setValue(this.plugin.settings.encryption.algorithm)
        .onChange(async (value) => {
          this.plugin.settings.encryption.algorithm = value as any;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Key Derivation Function')
      .setDesc('KDF for deriving encryption key from password')
      .addDropdown(dropdown => dropdown
        .addOption('argon2id', 'Argon2id (recommended)')
        .addOption('pbkdf2', 'PBKDF2')
        .setValue(this.plugin.settings.encryption.kdf)
        .onChange(async (value) => {
          this.plugin.settings.encryption.kdf = value as any;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('KDF Iterations')
      .setDesc('Number of iterations (higher = more secure, slower)')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(this.plugin.settings.encryption.kdfIterations)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.encryption.kdfIterations = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('KDF Memory')
      .setDesc('Memory cost in KB (Argon2id only)')
      .addSlider(slider => slider
        .setLimits(8192, 262144, 8192)
        .setValue(this.plugin.settings.encryption.kdfMemory)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.encryption.kdfMemory = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('KDF Parallelism')
      .setDesc('Parallelism factor (Argon2id only)')
      .addSlider(slider => slider
        .setLimits(1, 8, 1)
        .setValue(this.plugin.settings.encryption.kdfParallelism)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.encryption.kdfParallelism = value;
          await this.plugin.saveSettings();
        }));
    
    // Password setup
    new Setting(containerEl)
      .setName('Set Encryption Password')
      .setDesc('Set or change the encryption password')
      .addButton(btn => btn
        .setButtonText('Set Password')
        .setCta()
        .onClick(async () => {
          const password = await this.promptPassword('Enter new encryption password');
          if (password) {
            const confirm = await this.promptPassword('Confirm encryption password');
            if (password === confirm) {
              // Initialize encryption with new password
              const encryptionService = this.plugin.getSyncEngine()?.s3Backend?.encryptionService;
              if (encryptionService) {
                await encryptionService.initialize(password);
                new Notice('Encryption password set successfully');
              }
            } else {
              new Notice('Passwords do not match');
            }
          }
        }));
    
    // Warning
    const warningEl = containerEl.createDiv({ cls: 'nexavault-encryption-warning' });
    warningEl.style.cssText = 'margin-top: 16px; padding: 16px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; color: var(--text-error); font-size: 12px;';
    warningEl.innerHTML = `
      <strong>⚠ Important:</strong> If you lose your encryption password, 
      your encrypted backups will be <strong>permanently unrecoverable</strong>. 
      There is no backdoor or recovery mechanism. 
      Store your password in a secure password manager.
    `;
  }

  private createExclusionSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Exclusions' });
    
    new Setting(containerEl)
      .setName('Exclude Workspace Files')
      .setDesc('Exclude workspace.json and workspace-mobile.json')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.exclusions.excludeObsidianWorkspace)
        .onChange(async (value) => {
          this.plugin.settings.exclusions.excludeObsidianWorkspace = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Exclude Plugins Directory')
      .setDesc('Exclude .obsidian/plugins/')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.exclusions.excludeObsidianPlugins)
        .onChange(async (value) => {
          this.plugin.settings.exclusions.excludeObsidianPlugins = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Exclude Themes Directory')
      .setDesc('Exclude .obsidian/themes/')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.exclusions.excludeObsidianThemes)
        .onChange(async (value) => {
          this.plugin.settings.exclusions.excludeObsidianThemes = value;
          await this.plugin.saveSettings();
        }));
    
    // Custom paths
    containerEl.createEl('h3', { text: 'Custom Excluded Paths', style: 'margin-top: 16px; margin-bottom: 8px;' });
    
    const pathsContainer = containerEl.createDiv({ cls: 'nexavault-excluded-paths' });
    pathsContainer.style.marginBottom = '16px';
    
    const renderPaths = () => {
      pathsContainer.empty();
      for (const path of this.plugin.settings.exclusions.paths) {
        new Setting(pathsContainer)
          .setName(path)
          .addButton(btn => btn
            .setIcon('trash')
            .onClick(async () => {
              this.plugin.settings.exclusions.paths = this.plugin.settings.exclusions.paths.filter(p => p !== path);
              await this.plugin.saveSettings();
              renderPaths();
            }));
      }
    };
    
    renderPaths();
    
    new Setting(containerEl)
      .setName('Add Excluded Path')
      .addText(text => text
        .setPlaceholder('path/to/exclude')
        .onChange(async (value) => {
          if (value && !this.plugin.settings.exclusions.paths.includes(value)) {
            this.plugin.settings.exclusions.paths.push(value);
            await this.plugin.saveSettings();
            renderPaths();
          }
        }));
    
    // Patterns
    containerEl.createEl('h3', { text: 'Exclusion Patterns (glob)', style: 'margin-top: 16px; margin-bottom: 8px;' });
    
    const patternsContainer = containerEl.createDiv({ cls: 'nexavault-excluded-patterns' });
    patternsContainer.style.marginBottom = '16px';
    
    const renderPatterns = () => {
      patternsContainer.empty();
      for (const pattern of this.plugin.settings.exclusions.patterns) {
        new Setting(patternsContainer)
          .setName(pattern)
          .addButton(btn => btn
            .setIcon('trash')
            .onClick(async () => {
              this.plugin.settings.exclusions.patterns = this.plugin.settings.exclusions.patterns.filter(p => p !== pattern);
              await this.plugin.saveSettings();
              renderPatterns();
            }));
      }
    };
    
    renderPatterns();
    
    new Setting(containerEl)
      .setName('Add Exclusion Pattern')
      .addText(text => text
        .setPlaceholder('*.tmp')
        .onChange(async (value) => {
          if (value && !this.plugin.settings.exclusions.patterns.includes(value)) {
            this.plugin.settings.exclusions.patterns.push(value);
            await this.plugin.saveSettings();
            renderPatterns();
          }
        }));
  }

  private createAdvancedSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Advanced' });
    
    new Setting(containerEl)
      .setName('Log Level')
      .setDesc('Verbosity of logs')
      .addDropdown(dropdown => dropdown
        .addOption('debug', 'Debug')
        .addOption('info', 'Info')
        .addOption('warn', 'Warn')
        .addOption('error', 'Error')
        .setValue(this.plugin.settings.advanced.logLevel)
        .onChange(async (value) => {
          this.plugin.settings.advanced.logLevel = value as any;
          await this.plugin.saveSettings();
          this.plugin.getLogger().setLevel(value as any);
        }));
    
    new Setting(containerEl)
      .setName('Max Retry Attempts')
      .setDesc('Maximum number of retry attempts for failed operations')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(this.plugin.settings.advanced.maxRetryAttempts)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.advanced.maxRetryAttempts = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Base Retry Delay')
      .setDesc('Initial retry delay in milliseconds')
      .addSlider(slider => slider
        .setLimits(500, 10000, 500)
        .setValue(this.plugin.settings.advanced.baseRetryDelayMs)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.advanced.baseRetryDelayMs = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Max Retry Delay')
      .setDesc('Maximum retry delay in milliseconds')
      .addSlider(slider => slider
        .setLimits(5000, 300000, 5000)
        .setValue(this.plugin.settings.advanced.maxRetryDelayMs)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.advanced.maxRetryDelayMs = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Retry Jitter')
      .setDesc('Add random jitter to retry delays')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.advanced.retryJitter)
        .onChange(async (value) => {
          this.plugin.settings.advanced.retryJitter = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Bandwidth Limit')
      .setDesc('Maximum bandwidth in Kbps (0 = unlimited)')
      .addSlider(slider => slider
        .setLimits(0, 100000, 1000)
        .setValue(this.plugin.settings.advanced.bandwidthLimitKbps)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.advanced.bandwidthLimitKbps = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Verify Hashes After Upload')
      .setDesc('Verify file hashes after uploading to remote')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.advanced.verifyHashesAfterUpload)
        .onChange(async (value) => {
          this.plugin.settings.advanced.verifyHashesAfterUpload = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Verify Hashes After Download')
      .setDesc('Verify file hashes after downloading from remote')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.advanced.verifyHashesAfterDownload)
        .onChange(async (value) => {
          this.plugin.settings.advanced.verifyHashesAfterDownload = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Enable Rename Detection')
      .setDesc('Detect file renames using content hashes')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.advanced.enableRenameDetection)
        .onChange(async (value) => {
          this.plugin.settings.advanced.enableRenameDetection = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Rename Detection Threshold')
      .setDesc('Similarity threshold for rename detection (0-1)')
      .addSlider(slider => slider
        .setLimits(0.5, 1.0, 0.01)
        .setValue(this.plugin.settings.advanced.renameDetectionThreshold)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.advanced.renameDetectionThreshold = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Delete Safety Threshold')
      .setDesc('Warn if more than this many files appear deleted at once')
      .addSlider(slider => slider
        .setLimits(10, 500, 10)
        .setValue(this.plugin.settings.advanced.deleteSafetyThreshold)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.advanced.deleteSafetyThreshold = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('Crash Recovery')
      .setDesc('Enable crash recovery mechanisms')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.advanced.crashRecoveryEnabled)
        .onChange(async (value) => {
          this.plugin.settings.advanced.crashRecoveryEnabled = value;
          await this.plugin.saveSettings();
        }));
  }

  private async promptPassword(prompt: string): Promise<string | null> {
    // Simple prompt - in reality would use a proper modal
    const password = window.prompt(prompt);
    return password;
  }
}
