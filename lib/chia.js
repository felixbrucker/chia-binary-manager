const spawn = require('cross-spawn');
const { dirname, basename, join } = require('path');
const EventEmitter = require('events');
const { promises: fs } = require('fs');
const YAML = require('js-yaml');

class Chia {
  constructor({ binaryPath, rootDirectory }) {
    this.binaryPath = binaryPath;
    this.rootDirectory = rootDirectory;

    this.events = new EventEmitter();
    this.events.on('error', () => {}); // Discard errors when no error listener is attached

    this.runningProcess = null;
  }

  on(...args) {
    this.events.on(...args);
  }

  async readConfig() {
    const configYaml = await fs.readFile(this._chiaConfigPath, 'utf8');

    return YAML.load(configYaml);
  }

  async writeConfig(config) {
    const configYaml = YAML.dump(config, { lineWidth: 140 });
    await fs.writeFile(this._chiaConfigPath, configYaml);
  }

  async init() {
    const args = this._defaultArgs.concat([
      'init',
    ]);
    await this._spawnBinaryAndWaitForClose(args);
  }

  async startDaemon() {
    const args = this._defaultArgs.concat([
      'run_daemon',
    ]);
    await this._spawnBinaryAndWaitForClose(args);
  }

  async startHarvester() {
    const args = this._defaultArgs.concat([
      'start',
      'harvester',
    ]);
    await this._spawnBinaryAndWaitForClose(args);
  }

  async createPlot({
    tempDirectory,
    destinationDirectory,
    kSize = 32,
    threads = 2,
    buckets = 128,
    memoryInMib = 4000,
    farmerPublicKey = null,
    poolPublicKey = null,
    useBitfield = false,
  }) {
    const args = this._defaultArgs.concat([
      'plots',
      'create',
      '-k',
      kSize,
      '-r',
      threads,
      '-u',
      buckets,
      '-b',
      Math.round(memoryInMib),
      '-t',
      tempDirectory,
      '-2',
      destinationDirectory,
      '-d',
      destinationDirectory,
    ]);
    if (farmerPublicKey) {
      args.push('-f', farmerPublicKey);
    }
    if (poolPublicKey) {
      args.push('-p', poolPublicKey);
    }
    if (!useBitfield) {
      args.push('-e');
    }
    await this._spawnBinaryAndWaitForClose(args);
  }

  clone() {
    return new Chia({ rootDirectory: this.rootDirectory, binaryPath: this.binaryPath });
  }

  async kill() {
    if (!this.runningProcess) {
      return;
    }
    this.runningProcess.kill();
    this.runningProcess = null;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async _spawnBinaryAndWaitForClose(args) {
    this.runningProcess = this._spawnBinary(args);
    const closed = this._closed(this.runningProcess);
    this._registerOutputEvents(this.runningProcess);
    await closed;
  }

  _registerOutputEvents(ref) {
    ref.stdout.on('data', (data) => this.events.emit(`stdout`, data.toString().trim()));
    ref.stderr.on('data', (data) => this.events.emit(`stderr`, data.toString().trim()));
  }

  _closed(ref) {
    return new Promise((resolve, reject) => {
      let resolved = false;
      ref.once('close', (code) => {
        if (resolved) {
          return;
        }
        resolved = true;
        if (code === 0) {
          return resolve();
        }
        reject(code);
      });
      ref.once('error', (err) => {
        if (resolved) {
          return;
        }
        resolved = true;
        reject(err);
      });
    });
  }

  _spawnBinary(args) {
    return spawn(`./${basename(this.binaryPath)}`, args, {
      cwd: dirname(this.binaryPath),
      stdio: 'pipe',
    });
  }

  get _chiaConfigPath() {
    return join(this.chiaRootDirectory, 'config', 'config.yaml');
  }

  get _defaultArgs() {
    return [
      '--root-path',
      this.rootDirectory,
    ];
  }
}

module.exports = Chia;
