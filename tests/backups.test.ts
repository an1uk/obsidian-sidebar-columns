import test from 'node:test';
import assert from 'node:assert/strict';
import { BackupStore, type FileAdapter } from '../src/backups';
import type { RawLayout } from '../src/layout';

function layout(): RawLayout {
	return { main: { id: 'main', type: 'split', direction: 'vertical', children: [] },
		left: { id: 'left', type: 'split', direction: 'horizontal', children: [] },
		right: { id: 'right', type: 'split', direction: 'horizontal', children: [] }, privateState: 'retained locally' };
}

class MemoryAdapter implements FileAdapter {
	files = new Map<string, string>();
	folders = new Set<string>();
	failWrite = false;
	failMetadataRename = false;
	tamperReadback = false;
	async exists(path: string): Promise<boolean> { return this.files.has(path) || this.folders.has(path); }
	async mkdir(path: string): Promise<void> { this.folders.add(path); }
	async read(path: string): Promise<string> {
		const value = this.files.get(path);
		if (value === undefined) throw new Error('missing');
		return this.tamperReadback && path.endsWith('.workspace.json.tmp') ? value.replace('retained locally', 'changed') : value;
	}
	async write(path: string, value: string): Promise<void> { if (this.failWrite) throw new Error('disk unavailable'); this.files.set(path, value); }
	async rename(path: string, newPath: string): Promise<void> {
		if (this.failMetadataRename && newPath.endsWith('.metadata.json')) throw new Error('rename failed');
		if (this.files.has(newPath)) throw new Error('destination exists');
		const value = await this.read(path); this.files.set(newPath, value); this.files.delete(path);
	}
	async remove(path: string): Promise<void> { this.files.delete(path); }
	async list(path: string): Promise<{ files: string[]; folders: string[] }> {
		return { files: [...this.files.keys()].filter(file => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes('/')), folders: [] };
	}
}

function setup(configDir = '.custom-obsidian'): { adapter: MemoryAdapter; store: BackupStore } {
	const adapter = new MemoryAdapter(); let tick = 0;
	return { adapter, store: new BackupStore(adapter, configDir, '1.14.4', { now: () => new Date(Date.UTC(2026, 9, 8, 12, 0, tick++)) }) };
}

test('writes recoverable raw workspace JSON separately from integrity metadata in actual config directory', async () => {
	const { adapter, store } = setup(); const raw = layout();
	const snapshot = await store.create(raw, 'before-split');
	assert.equal(snapshot.baseline, true);
	assert.ok(snapshot.rawPath.startsWith('.custom-obsidian/sidebar-columns-backups/baseline-'));
	assert.deepEqual(JSON.parse(adapter.files.get(snapshot.rawPath) ?? ''), raw);
	assert.equal(JSON.parse(adapter.files.get(snapshot.rawPath) ?? '').formatVersion, undefined);
	const metadata = JSON.parse(adapter.files.get(snapshot.metadataPath) ?? '') as Record<string, unknown>;
	assert.equal(metadata.formatVersion, 1); assert.equal(metadata.pluginVersion, '0.1.0');
	assert.match(String(metadata.sha256), /^[a-f0-9]{64}$/);
	assert.deepEqual(await store.load(snapshot), raw);
	assert.deepEqual(raw, layout());
});

test('retains protected baseline plus only five recent pre-operation snapshots', async () => {
	const { adapter, store } = setup();
	const baseline = await store.create(layout(), 'before-split');
	const baselineBytes = adapter.files.get(baseline.rawPath);
	for (let i = 0; i < 9; i++) await store.create({ ...layout(), counter: i }, 'before-split');
	const snapshots = await store.list();
	assert.equal(snapshots.length, 6); assert.equal(snapshots.filter(item => item.baseline).length, 1);
	assert.equal(adapter.files.get(baseline.rawPath), baselineBytes);
	assert.deepEqual(await store.load(baseline), layout());
	assert.equal(adapter.files.size, 12);
});

test('required write failure and corrupted readback reject backup creation', async () => {
	const first = setup(); first.adapter.failWrite = true;
	await assert.rejects(first.store.create(layout(), 'before-split'), /could not be saved/);
	assert.equal(first.adapter.files.size, 0);
	const second = setup(); second.adapter.tamperReadback = true;
	await assert.rejects(second.store.create(layout(), 'before-split'), /could not be verified/);
	assert.equal(second.adapter.files.size, 0);
});

test('checksum mismatch refuses restore and routine backup rotation', async () => {
	const { adapter, store } = setup(); const snapshot = await store.create(layout(), 'before-split');
	adapter.files.set(snapshot.rawPath, JSON.stringify({ ...layout(), privateState: 'tampered' }));
	const before = [...adapter.files.entries()];
	await assert.rejects(store.load(snapshot), /integrity/);
	await assert.rejects(store.create(layout(), 'before-split'), /integrity/);
	assert.deepEqual([...adapter.files.entries()], before);
});

test('corrupt or missing baseline metadata prevents replacement and deletion', async () => {
	for (const mode of ['corrupt', 'missing', 'incompatible'] as const) {
		const { adapter, store } = setup(); const baseline = await store.create(layout(), 'before-split');
		if (mode === 'missing') adapter.files.delete(baseline.metadataPath);
		else if (mode === 'corrupt') adapter.files.set(baseline.metadataPath, '{bad');
		else {
			const data = JSON.parse(adapter.files.get(baseline.metadataPath) ?? '') as Record<string, unknown>;
			data.formatVersion = 2; adapter.files.set(baseline.metadataPath, JSON.stringify(data));
		}
		const before = [...adapter.files.entries()];
		await assert.rejects(store.create(layout(), 'before-split'));
		assert.deepEqual([...adapter.files.entries()], before);
	}
});

test('interrupted pair rename preserves raw backup and blocks ambiguous future writes', async () => {
	const { adapter, store } = setup(); adapter.failMetadataRename = true;
	await assert.rejects(store.create(layout(), 'before-split'), /could not be saved/);
	assert.equal([...adapter.files.keys()].filter(path => path.endsWith('.workspace.json')).length, 1);
	adapter.failMetadataRename = false;
	await assert.rejects(store.create(layout(), 'before-split'), /incomplete/);
});

test('rejects unsafe config or snapshot paths without external reads', async () => {
	const { adapter, store } = setup();
	assert.throws(() => new BackupStore(adapter, '../outside', '1.14.4'));
	assert.throws(() => new BackupStore(adapter, 'C:/outside', '1.14.4'));
	const snapshot = await store.create(layout(), 'before-split');
	await assert.rejects(store.load({ ...snapshot, rawPath: '../outside' }), /path/);
});

test('selected metadata replacement is detected before restore', async () => {
	const { adapter, store } = setup(); const snapshot = await store.create(layout(), 'before-split');
	const data = JSON.parse(adapter.files.get(snapshot.metadataPath) ?? '') as Record<string, unknown>;
	data.reason = 'changed'; adapter.files.set(snapshot.metadataPath, JSON.stringify(data));
	await assert.rejects(store.load(snapshot), /metadata changed/);
});

test('retains the mandatory newly created snapshot when timestamps tie or clocks move backwards', async () => {
	const adapter = new MemoryAdapter(); let time = Date.UTC(2026, 9, 8);
	const store = new BackupStore(adapter, '.custom', '1.14.4', { now: () => new Date(time), maxRecent: 2 });
	await store.create(layout(), 'before-split');
	for (let i = 0; i < 5; i++) {
		if (i > 2) time--;
		const raw = { ...layout(), operation: i };
		const created = await store.create(raw, 'before-split');
		assert.deepEqual(await store.load(created), raw);
		assert.ok((await store.list()).some(item => item.id === created.id));
	}
	assert.equal((await store.list()).length, 3);
});
