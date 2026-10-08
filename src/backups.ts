import { cloneLayout, parseLayout, RawLayout } from './layout';

export interface FileAdapter {
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	rename(path: string, newPath: string): Promise<void>;
	remove(path: string): Promise<void>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

export interface Snapshot {
	id: string;
	rawPath: string;
	metadataPath: string;
	timestamp: string;
	baseline: boolean;
	reason: string;
	appVersion: string;
}

interface Metadata {
	formatVersion: 1;
	pluginVersion: string;
	id: string;
	rawFile: string;
	timestamp: string;
	baseline: boolean;
	reason: string;
	appVersion: string;
	sha256: string;
}

export class BackupError extends Error {
	constructor(message: string) { super(message); this.name = 'BackupError'; }
}

const metadataSuffix = '.metadata.json';
const rawSuffix = '.workspace.json';
const idPattern = /^(?:baseline|snapshot)-[A-Za-z0-9-]{1,100}$/;

function directory(configDir: string): string {
	const normalized = configDir.replace(/\\/g, '/').replace(/\/+$/, '');
	if (!normalized || normalized.startsWith('/') || normalized.includes(':') || normalized.includes('\0') ||
		normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
		throw new BackupError('The vault configuration directory is invalid.');
	}
	return `${normalized}/sidebar-columns-backups`;
}

async function checksum(text: string): Promise<string> {
	if (!globalThis.crypto?.subtle) throw new BackupError('Secure SHA-256 hashing is unavailable; no layout changes were made.');
	const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function metadata(text: string, expectedId: string): Metadata {
	let value: unknown;
	try { value = JSON.parse(text) as unknown; }
	catch { throw new BackupError('A backup metadata file is corrupt. Backups were left untouched.'); }
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BackupError('A backup metadata file is incompatible.');
	const entry = value as Record<string, unknown>;
	if (entry.formatVersion !== 1 || typeof entry.pluginVersion !== 'string' || !entry.pluginVersion ||
		entry.id !== expectedId || !idPattern.test(expectedId) || entry.rawFile !== `${expectedId}${rawSuffix}` ||
		typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp)) ||
		typeof entry.baseline !== 'boolean' || entry.baseline !== expectedId.startsWith('baseline-') ||
		typeof entry.reason !== 'string' || !entry.reason || entry.reason.length > 120 ||
		typeof entry.appVersion !== 'string' || !entry.appVersion ||
		typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
		throw new BackupError('A backup metadata file is incompatible. Backups were left untouched.');
	}
	return entry as unknown as Metadata;
}

export interface BackupOptions { now?: () => Date; maxRecent?: number; }

/** Immutable raw layout files and separate metadata; never writes Obsidian's workspace file. */
export class BackupStore {
	readonly root: string;
	private readonly now: () => Date;
	private readonly maxRecent: number;
	private creating = false;
	constructor(private readonly adapter: FileAdapter, configDir: string, private readonly appVersion: string, options: BackupOptions = {}) {
		this.root = directory(configDir);
		this.now = options.now ?? (() => new Date());
		this.maxRecent = options.maxRecent ?? 5;
		if (!Number.isInteger(this.maxRecent) || this.maxRecent < 1 || this.maxRecent > 50) throw new BackupError('The backup retention count is invalid.');
		if (!appVersion) throw new BackupError('The Obsidian version is missing.');
	}

	private snapshot(entry: Metadata): Snapshot {
		return { id: entry.id, rawPath: `${this.root}/${entry.rawFile}`, metadataPath: `${this.root}/${entry.id}${metadataSuffix}`,
			timestamp: entry.timestamp, baseline: entry.baseline, reason: entry.reason, appVersion: entry.appVersion };
	}

	async list(): Promise<Snapshot[]> {
		if (!await this.adapter.exists(this.root)) return [];
		const listed = await this.adapter.list(this.root);
		const entries: Snapshot[] = [];
		const knownRaw = new Set<string>();
		for (const path of listed.files) {
			if (!path.endsWith(metadataSuffix)) continue;
			if (!path.startsWith(`${this.root}/`) || path.slice(this.root.length + 1).includes('/')) throw new BackupError('The backup directory contains an unsafe metadata path.');
			const id = path.slice(this.root.length + 1, -metadataSuffix.length);
			const entry = metadata(await this.adapter.read(path), id);
			const item = this.snapshot(entry);
			if (!await this.adapter.exists(item.rawPath)) throw new BackupError('A backup layout file is missing. Backups were left untouched.');
			knownRaw.add(item.rawPath);
			entries.push(item);
		}
		if (listed.files.some(path => path.endsWith(rawSuffix) && !knownRaw.has(path))) throw new BackupError('An incomplete layout backup needs review. Backups were left untouched.');
		if (entries.length > 0 && entries.filter(entry => entry.baseline).length !== 1) throw new BackupError('The protected baseline metadata is missing or ambiguous. Backups were left untouched.');
		return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
	}

	async load(snapshot: Snapshot): Promise<RawLayout> {
		if (!idPattern.test(snapshot.id) || snapshot.rawPath !== `${this.root}/${snapshot.id}${rawSuffix}` ||
			snapshot.metadataPath !== `${this.root}/${snapshot.id}${metadataSuffix}`) throw new BackupError('The selected backup path is invalid.');
		const entry = metadata(await this.adapter.read(snapshot.metadataPath), snapshot.id);
		const actual = this.snapshot(entry);
		if (actual.timestamp !== snapshot.timestamp || actual.baseline !== snapshot.baseline || actual.reason !== snapshot.reason || actual.appVersion !== snapshot.appVersion) {
			throw new BackupError('The selected backup metadata changed. Select the backup again.');
		}
		const raw = await this.adapter.read(actual.rawPath);
		if (await checksum(raw) !== entry.sha256) throw new BackupError('The layout backup failed its integrity check. It was not restored.');
		return parseLayout(raw);
	}

	async create(layout: RawLayout, reason: string): Promise<Snapshot> {
		if (this.creating) throw new BackupError('Another layout backup is already in progress.');
		this.creating = true;
		let rawTemp: string | undefined;
		let metadataTemp: string | undefined;
		try {
			if (!reason || reason.length > 120) throw new BackupError('The backup reason is invalid.');
			const raw = JSON.stringify(cloneLayout(layout), null, 2);
			const existing = await this.list();
			// Validate retained files before rotation; damaged backups cannot cause baseline replacement.
			for (const item of existing) await this.load(item);
			if (!await this.adapter.exists(this.root)) await this.adapter.mkdir(this.root);
			const baseline = existing.length === 0;
			const timestamp = this.now().toISOString();
			const random = new Uint8Array(8);
			if (!globalThis.crypto?.getRandomValues) throw new BackupError('Secure backup ID generation is unavailable.');
			globalThis.crypto.getRandomValues(random);
			const entropy = Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
			const id = `${baseline ? 'baseline' : 'snapshot'}-${timestamp.replace(/[:.]/g, '-')}-${entropy}`;
			const rawPath = `${this.root}/${id}${rawSuffix}`;
			const metadataPath = `${this.root}/${id}${metadataSuffix}`;
			if (await this.adapter.exists(rawPath) || await this.adapter.exists(metadataPath)) throw new BackupError('The backup filename already exists; no backup was overwritten.');
			const entry: Metadata = { formatVersion: 1, pluginVersion: '0.1.0', id, rawFile: `${id}${rawSuffix}`,
				timestamp, baseline, reason, appVersion: this.appVersion, sha256: await checksum(raw) };
			rawTemp = `${rawPath}.tmp`;
			metadataTemp = `${metadataPath}.tmp`;
			await this.adapter.write(rawTemp, raw);
			const readback = await this.adapter.read(rawTemp);
			parseLayout(readback);
			if (await checksum(readback) !== entry.sha256) throw new BackupError('The layout backup could not be verified; no layout changes were made.');
			await this.adapter.write(metadataTemp, JSON.stringify(entry, null, 2));
			metadata(await this.adapter.read(metadataTemp), id);
			await this.adapter.rename(rawTemp, rawPath);
			await this.adapter.rename(metadataTemp, metadataPath);
			const created = this.snapshot(entry);
			await this.load(created);
			// Always retain the just-written required backup, including tied or backwards clocks.
			const previousRecent = existing.filter(item => !item.baseline)
				.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
			const retainedPrevious = this.maxRecent - (created.baseline ? 0 : 1);
			for (const old of previousRecent.slice(retainedPrevious)) {
				// Deleting metadata first makes partial rotation fail closed on the next operation.
				await this.adapter.remove(old.metadataPath);
				await this.adapter.remove(old.rawPath);
			}
			return created;
		} catch (error: unknown) {
			if (error instanceof BackupError || error instanceof Error && error.name === 'LayoutValidationError') throw error;
			throw new BackupError('The layout backup could not be saved. No layout changes were made.');
		} finally {
			for (const path of [rawTemp, metadataTemp]) {
				if (!path) continue;
				try { if (await this.adapter.exists(path)) await this.adapter.remove(path); } catch { /* Preserve any failed temporary write for local review. */ }
			}
			this.creating = false;
		}
	}
}
