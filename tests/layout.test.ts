import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneLayout, parseLayout, validateLayout, type RawLayout } from '../src/layout';

function layout(): RawLayout {
	return { main: { id: 'main', type: 'split', direction: 'vertical', children: [
		{ id: 'main-tabs', type: 'tabs', currentTab: 0, children: [{ id: 'editor', type: 'leaf', state: { type: 'markdown', state: { file: 'Private note.md' } } }] },
	] }, left: { id: 'left', type: 'split', direction: 'horizontal', width: 300, collapsed: false, children: [
		{ id: 'left-tabs', type: 'tabs', children: [{ id: 'explorer', type: 'leaf', state: { type: 'file-explorer' } }] },
	] }, right: { id: 'right', type: 'split', direction: 'horizontal', width: 300, collapsed: true, children: [] }, active: 'editor' };
}

function root(raw: RawLayout, name: string): Record<string, unknown> { return raw[name] as Record<string, unknown>; }

test('preserves unknown fields, state, sidebar proportions and unrelated branches', () => {
	const raw = layout();
	raw.futureField = { nested: ['unchanged', 42] };
	root(raw, 'left').futureSidebarControl = { enabled: true };
	const before = JSON.stringify(raw);
	const cloned = cloneLayout(raw);
	assert.deepEqual(cloned, raw);
	assert.notEqual(cloned, raw);
	assert.equal(JSON.stringify(raw), before);
});

test('accepts genuine nested columns and stacked rows under horizontal sidebar root', () => {
	const raw = layout();
	root(raw, 'right').children = [{ id: 'columns', type: 'split', direction: 'vertical', children: [
		{ id: 'rows', type: 'split', direction: 'horizontal', children: [
			{ id: 'outline-tabs', type: 'tabs', children: [{ id: 'outline', type: 'leaf', state: { type: 'outline' } }] },
			{ id: 'empty-tabs', type: 'tabs', children: [{ id: 'empty', type: 'leaf', state: { type: 'empty' } }] },
		] },
		{ id: 'calendar-tabs', type: 'tabs', children: [{ id: 'calendar', type: 'leaf', state: { type: 'calendar', state: { unknown: 'kept' }, pinned: true } }] },
	] }];
	assert.deepEqual(validateLayout(raw), raw);
});

test('accepts native floating windows and active pop-out leaf', () => {
	const raw = layout();
	raw.floating = { id: 'floating', type: 'floating', children: [{ id: 'window', type: 'window', x: 20, y: 10, children: [
		{ id: 'window-tabs', type: 'tabs', children: [{ id: 'popout', type: 'leaf', state: { type: 'empty' } }] },
	] }] };
	raw.active = 'popout';
	assert.equal(validateLayout(raw), raw);
});

for (const [name, change] of [
	['duplicate IDs', (raw: RawLayout) => { root(raw, 'left').id = 'main'; }],
	['invalid main orientation', (raw: RawLayout) => { root(raw, 'main').direction = 'horizontal'; }],
	['invalid outer sidebar orientation', (raw: RawLayout) => { root(raw, 'left').direction = 'vertical'; }],
	['missing view state', (raw: RawLayout) => { root(raw, 'left').children = [{ id: 'tabs', type: 'tabs', children: [{ id: 'leaf', type: 'leaf' }] }]; }],
	['orphaned leaf directly under split', (raw: RawLayout) => { root(raw, 'right').children = [{ id: 'leaf', type: 'leaf', state: { type: 'empty' } }]; }],
	['unknown active leaf', (raw: RawLayout) => { raw.active = 'missing'; }],
	['invalid sidebar width', (raw: RawLayout) => { root(raw, 'right').width = -20; }],
	['invalid current tab', (raw: RawLayout) => { root(raw, 'right').children = [{ id: 'tabs', type: 'tabs', currentTab: 4, children: [] }]; }],
	['unsupported floating child', (raw: RawLayout) => { raw.floating = { id: 'floating', type: 'floating', children: [{ id: 'tabs', type: 'tabs', children: [] }] }; }],
	['non-finite opaque state', (raw: RawLayout) => { raw.extra = Number.NaN; }],
	['function in opaque state', (raw: RawLayout) => { raw.extra = () => undefined; }],
] as const) {
	test(`rejects ${name}`, () => { const raw = layout(); change(raw); assert.throws(() => validateLayout(raw)); });
}

test('rejects cycles even in unknown fields and malformed snapshots', () => {
	const raw = layout(); raw.cycle = raw;
	assert.throws(() => validateLayout(raw), /cycle/);
	assert.throws(() => parseLayout('{broken'), /valid JSON/);
	assert.throws(() => validateLayout({ formatVersion: 1, layout: layout() }), /root/);
});
