import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationService, type OperationPort } from '../src/operations';
import type { Snapshot } from '../src/backups';
import type { RawLayout } from '../src/layout';

function layout(value = 'current'): RawLayout {
	return { main: { id: 'main', type: 'split', direction: 'vertical', children: [] },
		left: { id: 'left', type: 'split', direction: 'horizontal', children: [] },
		right: { id: 'right', type: 'split', direction: 'horizontal', children: [] }, value };
}
const snapshot: Snapshot = { id: 'baseline-test', rawPath: 'test.workspace.json', metadataPath: 'test.metadata.json',
	timestamp: '2026-10-08T12:00:00.000Z', baseline: true, reason: 'before-split', appVersion: '1.14.4' };
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
	return { promise, resolve };
}
function setup(): { service: OperationService<string>; port: OperationPort<string>; calls: string[]; state: { acknowledged: boolean; current: boolean; revision: number } } {
	const calls: string[] = [];
	const state = { acknowledged: false, current: true, revision: 1 };
	const port: OperationPort<string> = {
		checkCompatibility: () => { calls.push('compatibility'); return true; },
		isTargetCurrent: target => state.current && target === 'sidebar',
		isAcknowledged: () => state.acknowledged,
		requestConsent: async () => { calls.push('consent'); return true; },
		persistAcknowledgement: async () => { calls.push('persist'); state.acknowledged = true; },
		captureLayout: () => { calls.push('capture'); return layout(); },
		captureRevision: () => state.revision,
		isRevisionCurrent: revision => revision === state.revision,
		createBackup: async (_layout, reason) => { calls.push(`backup:${reason}`); return snapshot; },
		loadBackup: async () => { calls.push('load'); return layout('saved'); },
		confirmFullRestore: async () => { calls.push('confirm-full-restore'); return true; },
		addColumn: () => { calls.push('add-column'); },
		split: () => { calls.push('split'); },
		collapse: () => { calls.push('collapse'); },
		applyFullLayout: async raw => { calls.push(`apply-full:${String(raw.value)}`); },
	};
	return { service: new OperationService(port), port, calls, state };
}

test('consent and durable acknowledgement precede required backup and split', async () => {
	const { service, calls } = setup();
	assert.equal((await service.split('sidebar')).status, 'success');
	assert.deepEqual(calls, ['compatibility', 'consent', 'persist', 'capture', 'backup:before-split', 'split']);
	assert.equal(service.busy, false);
});

test('remembered consent is not repeated for collapse', async () => {
	const { service, state, calls } = setup(); state.acknowledged = true;
	assert.equal((await service.collapse('sidebar')).status, 'success');
	assert.deepEqual(calls, ['compatibility', 'capture', 'backup:before-collapse', 'collapse']);
});

test('consent cancellation performs no backup or mutation', async () => {
	const { service, port, calls } = setup(); port.requestConsent = async () => false;
	assert.equal((await service.split('sidebar')).status, 'cancelled');
	assert.deepEqual(calls, ['compatibility']);
});

test('failed acknowledgement persistence prevents backup and mutation', async () => {
	const { service, port, calls } = setup(); port.persistAcknowledgement = async () => { throw new Error('Settings could not be saved.'); };
	assert.equal((await service.split('sidebar')).status, 'error');
	assert.ok(!calls.includes('capture')); assert.ok(!calls.includes('split'));
});

test('required backup failure prevents mutation', async () => {
	const { service, port, calls } = setup(); port.createBackup = async () => { throw new Error('Backup could not be saved.'); };
	assert.equal((await service.split('sidebar')).status, 'error');
	assert.ok(!calls.includes('split')); assert.ok(!calls.some(call => call.startsWith('apply-full')));
});

test('central-workspace targets are rejected before asking for consent', async () => {
	const { service, calls } = setup();
	assert.equal((await service.split('central')).status, 'stale');
	assert.deepEqual(calls, ['compatibility']);
});

test('unsupported compatibility and cancelled per-version override leave layout untouched', async () => {
	const { service, port, calls } = setup(); port.checkCompatibility = async () => false;
	assert.equal((await service.split('sidebar')).status, 'blocked'); assert.deepEqual(calls, []);
});

test('target is revalidated after asynchronous compatibility override', async () => {
	const { service, port, state, calls } = setup(); const gate = deferred<boolean>();
	port.checkCompatibility = () => gate.promise;
	const pending = service.split('sidebar'); state.current = false; gate.resolve(true);
	assert.equal((await pending).status, 'stale'); assert.deepEqual(calls, []);
});

test('target changes while consent is open prevent mutation', async () => {
	const { service, port, state, calls } = setup();
	port.requestConsent = async () => { state.current = false; return true; };
	assert.equal((await service.split('sidebar')).status, 'stale');
	assert.ok(!calls.includes('capture')); assert.ok(!calls.includes('split'));
});

test('workspace revision changes during backup prevent mutation', async () => {
	const { service, port, state, calls } = setup();
	port.createBackup = async () => { state.revision++; return snapshot; };
	assert.equal((await service.split('sidebar')).status, 'stale'); assert.ok(!calls.includes('split'));
});

test('exclusive lock begins before asynchronous consent', async () => {
	const { service, port, calls } = setup(); const consent = deferred<boolean>();
	port.requestConsent = () => consent.promise;
	const pending = service.split('sidebar');
	assert.equal(service.busy, true);
	assert.equal((await service.collapse('sidebar')).status, 'blocked');
	consent.resolve(false); assert.equal((await pending).status, 'cancelled');
	assert.ok(!calls.includes('collapse')); assert.equal(service.busy, false);
});

test('dispose during backup blocks mutation and future operations', async () => {
	const { service, port, state, calls } = setup(); state.acknowledged = true;
	const backup = deferred<Snapshot>(); const reached = deferred<void>();
	port.createBackup = () => { reached.resolve(); return backup.promise; };
	const pending = service.split('sidebar'); await reached.promise;
	service.dispose(); backup.resolve(snapshot);
	assert.equal((await pending).status, 'blocked'); assert.ok(!calls.includes('split'));
	assert.equal((await service.split('sidebar')).status, 'blocked');
});

test('restore requires full-workspace confirmation and saves current layout before application', async () => {
	const { service, port, state, calls } = setup(); state.acknowledged = true;
	port.createBackup = async (raw, reason) => { assert.equal(raw.value, 'current'); calls.push(`backup:${reason}`); return snapshot; };
	assert.equal((await service.restore(snapshot)).status, 'success');
	assert.deepEqual(calls, ['compatibility', 'load', 'confirm-full-restore', 'capture', 'backup:pre-restore', 'apply-full:saved']);
});

test('restore cancellation and corrupt snapshot do not apply or create backup', async () => {
	const cancelled = setup(); cancelled.port.confirmFullRestore = async () => false;
	assert.equal((await cancelled.service.restore(snapshot)).status, 'cancelled');
	assert.ok(!cancelled.calls.includes('capture'));
	const corrupt = setup(); corrupt.port.loadBackup = async () => { throw new Error('The snapshot is corrupt.'); };
	assert.equal((await corrupt.service.restore(snapshot)).status, 'error');
	assert.ok(!corrupt.calls.includes('confirm-full-restore')); assert.ok(!corrupt.calls.includes('capture'));
});

test('new workspace state during pre-restore backup prevents overwriting current layout', async () => {
	const { service, port, state, calls } = setup(); state.acknowledged = true;
	port.createBackup = async () => { state.revision++; return snapshot; };
	assert.equal((await service.restore(snapshot)).status, 'stale');
	assert.ok(!calls.some(call => call.startsWith('apply-full')));
});

test('failed split and failed restore do not automatically reload an old workspace', async () => {
	const split = setup(); split.port.split = () => { throw new Error('Narrow split rollback completed.'); };
	assert.equal((await split.service.split('sidebar')).status, 'error');
	assert.ok(!split.calls.some(call => call.startsWith('apply-full')));
	const restore = setup(); restore.state.acknowledged = true; let applyCount = 0;
	restore.port.applyFullLayout = async () => { applyCount++; throw new Error('Restoration failed.'); };
	assert.equal((await restore.service.restore(snapshot)).status, 'error'); assert.equal(applyCount, 1);
});

test('full-height primary action uses the same consent lock and required backup boundary', async () => {
 const {service,calls}=setup();
 assert.equal((await service.addColumn('sidebar')).status,'success');
 assert.deepEqual(calls,['compatibility','consent','persist','capture','backup:before-add-column','add-column']);
});
test('failed mandatory backup prevents full-height column creation', async () => {
 const {service,port,calls}=setup();
 port.createBackup=async()=>{throw new Error('cannot write');};
 assert.equal((await service.addColumn('sidebar')).status,'error');
 assert.ok(!calls.includes('add-column'));
});
