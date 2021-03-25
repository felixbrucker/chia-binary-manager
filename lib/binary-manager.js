const axios = require('axios');
const decompress = require('decompress');
const EventEmitter = require('events');
const mkdirp = require('mkdirp');
const semver = require('semver');
const { existsSync, createWriteStream, promises: fs } = require('fs');
const { join } = require('path');
const { platform, tmpdir, homedir } = require('os');

const Chia = require('./chia');

const repo = 'chia-binary-manager'
const releaseUrl = `https://api.github.com/repos/felixbrucker/${repo}/releases/40423266`;

class BinaryManager {
  constructor({
    binaryDirectory = this._defaultBinaryDirectory,
    chiaRootDirectory = this._defaultChiaRootDirectory,
    notifyOnUpdate = true,
  } = {}) {
    this.binaryDirectory = binaryDirectory;
    this.chiaRootDirectory = chiaRootDirectory;
    this.notifyOnUpdate = notifyOnUpdate;

    this.events = new EventEmitter();
  }

  async init() {
    mkdirp.sync(this.binaryDirectory, { mode: 0o770 });
    this.latestRelease = await this._getLatestRelease();

    if (this.notifyOnUpdate) {
      setInterval(this._updateLatestRelease.bind(this), 15 * 60 * 1000);
      await this._updateLatestRelease();
    }
  }

  onNewRelease(cb) {
    this.events.on('new-release', cb);
  }

  async getConfiguredChia(version = this.latestRelease.version) {
    const chiaBinaryPath = await this._getChiaBinaryPath(version);
    return new Chia({ binaryPath: chiaBinaryPath, rootDirectory: this.chiaRootDirectory });
  }

  async _getChiaBinaryPath(version) {
    await this._ensureVersionExists(version);
    const binName = this._binaryName;
    const binaryDirectory = await this._getBinaryDirectory(version);

    return join(binaryDirectory, binName);
  }

  async _ensureVersionExists(version) {
    const binaryDirectoryForVersion = this._getBinaryDirectory(version);
    const binaryPath = join(binaryDirectoryForVersion, this._binaryName);
    if (existsSync(binaryPath)) {
      return;
    }
    mkdirp.sync(binaryDirectoryForVersion, { mode: 0o770 });
    await this._downloadBinary(version);

    if (!existsSync(binaryPath)) {
      throw new Error(`Binary not found in ${binaryPath}!`);
    }
  }

  async _downloadBinary(version) {
    const tempDir = join(tmpdir(), 'chia-binary-manager');
    mkdirp.sync(tempDir, { mode: 0o770 });
    const zipFilePath = join(tempDir, `chia-${version}.zip`);

    const res = await axios.get(this._getDownloadUrl(version), { responseType: 'stream' });
    const writer = createWriteStream(zipFilePath);
    res.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    await decompress(zipFilePath, this._getBinaryDirectory(version));

    await fs.unlink(zipFilePath);
  }

  _getDownloadUrl(version) {
    switch (platform()) {
      case 'win32': return `https://github.com/felixbrucker/${repo}/releases/download/binaries/chia-${version}-win.zip`;
      case 'linux': return `https://github.com/felixbrucker/${repo}/releases/download/binaries/chia-${version}-linux.zip`;
      default: throw new Error(`Unsupported platform: ${platform()}`);
    }
  }

  async _updateLatestRelease() {
    let latestRelease;
    try {
      latestRelease = await this._getLatestRelease();
    } catch (err) {
      return;
    }
    if (!latestRelease || semver.lte(latestRelease.version, this.latestRelease.version)) {
      return;
    }
    try {
      await this._ensureVersionExists(latestRelease.version);
      this.latestRelease = latestRelease;
      this.events.emit('new-release', latestRelease.version);
    } catch (err) {}
  }

  async _getLatestRelease() {
    const { data } = await axios.get(releaseUrl);

    const assets = data.assets.map(asset => {
      const matches = asset.name.match(this._binaryZipRegex);
      if (matches) {
        asset.version = matches[1];
      }

      return asset;
    });
    const matchingAssets = assets.filter(asset => !!asset.version);

    return matchingAssets.reduce((latestReleaseAsset, curr) => {
      if (!latestReleaseAsset) {
        return curr;
      }

      return semver.gte(latestReleaseAsset.version, curr.version) ? latestReleaseAsset : curr
    }, null);
  }

  _getBinaryDirectory(version) {
    return join(this.binaryDirectory, version);
  }

  get _binaryName() {
    return platform() === 'win32' ? 'chia.exe' : 'chia';
  }

  get _binaryZipRegex() {
    switch (platform()) {
      case 'win32': return /chia-([0-9]+\.[0-9]+\.[0-9]+)-win.zip/;
      case 'linux': return /chia-([0-9]+\.[0-9]+\.[0-9]+)-linux.zip/;
      default: throw new Error(`Unsupported platform: ${platform()}`);
    }
  }

  get _defaultBinaryDirectory() {
    return join(
      homedir(),
      '.config',
      'chia-binary-manager',
      'binaries',
    );
  }

  get _defaultChiaRootDirectory() {
    return join(
      homedir(),
      '.config',
      'chia-binary-manager',
      'chia-root',
    );
  }
}

module.exports = BinaryManager;
