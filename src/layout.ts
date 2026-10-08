/** Native workspace layouts are private, version-sensitive JSON. */
export type RawLayout = Record<string, unknown>;

export class LayoutValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LayoutValidationError';
	}
}

function record(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}

function fail(message: string): never {
	throw new LayoutValidationError(message);
}

/** Reject cycles and non-JSON values even inside opaque plugin state. */
function checkJson(value: unknown, ancestors: Set<object>, depth = 0): void {
	if (depth > 128) fail('The layout exceeds the supported nesting depth.');
	if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) fail('The layout contains a non-finite number.');
		return;
	}
	if (typeof value !== 'object') fail('The layout contains an unsupported non-JSON value.');
	if (!Array.isArray(value) && !record(value)) fail('The layout contains an unsupported object.');
	if (ancestors.has(value)) fail('The layout contains a cycle.');
	ancestors.add(value);
	for (const child of Array.isArray(value) ? value : Object.values(value)) checkJson(child, ancestors, depth + 1);
	ancestors.delete(value);
}

type NodeType = 'split' | 'tabs' | 'leaf' | 'floating' | 'window';
const descendants: Record<Exclude<NodeType, 'leaf'>, readonly NodeType[]> = {
	split: ['split', 'tabs'],
	tabs: ['leaf'],
	floating: ['window'],
	window: ['split', 'tabs'],
};

/** Validate without rewriting or discarding unknown JSON fields. */
export function validateLayout(value: unknown): RawLayout {
	if (!record(value)) fail('The snapshot is not a workspace layout object.');
	checkJson(value, new Set());
	const ids = new Set<string>();
	const leafIds = new Set<string>();
	let nodeCount = 0;
	function visit(nodeValue: unknown, allowed: readonly NodeType[], depth: number): void {
		if (depth > 64 || ++nodeCount > 20000) fail('The workspace tree exceeds the supported size.');
		if (!record(nodeValue)) fail('The workspace tree contains an invalid node.');
		const type = nodeValue.type;
		if (typeof type !== 'string' || !allowed.includes(type as NodeType)) fail('The workspace tree contains an unsupported parent-child relationship.');
		const id = nodeValue.id;
		if (typeof id !== 'string' || id.length === 0 || id.length > 200) fail('The workspace tree contains a missing or invalid ID.');
		if (ids.has(id)) fail('The workspace tree contains duplicate IDs.');
		ids.add(id);
		if (nodeValue.dimension !== undefined && nodeValue.dimension !== null &&
			(typeof nodeValue.dimension !== 'number' || nodeValue.dimension < 0 || nodeValue.dimension > 100)) {
			fail('The workspace tree contains an invalid size proportion.');
		}
		if (type === 'leaf') {
			leafIds.add(id);
			if (nodeValue.children !== undefined) fail('A workspace leaf cannot contain children.');
			if (!record(nodeValue.state) || typeof nodeValue.state.type !== 'string' || nodeValue.state.type.length === 0) {
				fail('The workspace tree contains an invalid view state.');
			}
			return;
		}
		if (!Array.isArray(nodeValue.children)) fail('A workspace parent is missing its children.');
		if (type === 'split' && nodeValue.direction !== 'horizontal' && nodeValue.direction !== 'vertical') {
			fail('The workspace tree contains an invalid split direction.');
		}
		if (type === 'tabs' && nodeValue.currentTab !== undefined) {
			const current = nodeValue.currentTab;
			const empty = nodeValue.children.length === 0;
			if (typeof current !== 'number' || !Number.isInteger(current) ||
				(empty ? current !== -1 && current !== 0 : current < 0 || current >= nodeValue.children.length)) {
				fail('The workspace tree contains an invalid selected tab.');
			}
		}
		for (const child of nodeValue.children) visit(child, descendants[type as Exclude<NodeType, 'leaf'>], depth + 1);
	}
	for (const side of ['main', 'left', 'right'] as const) {
		const root = value[side];
		if (!record(root) || root.type !== 'split') fail('The layout is missing a native workspace root.');
		if (root.direction !== (side === 'main' ? 'vertical' : 'horizontal')) fail('The layout has an incompatible outer workspace direction.');
		if (side !== 'main') {
			if (root.width !== undefined && (typeof root.width !== 'number' || !Number.isFinite(root.width) || root.width <= 0)) fail('The layout contains an invalid sidebar width.');
			if (root.collapsed !== undefined && typeof root.collapsed !== 'boolean') fail('The layout contains an invalid sidebar collapse state.');
		}
		visit(root, ['split'], 0);
	}
	if (value.floating !== undefined) visit(value.floating, ['floating'], 0);
	if (value.active !== undefined && value.active !== null &&
		(typeof value.active !== 'string' || !leafIds.has(value.active))) fail('The layout refers to a missing active leaf.');
	return value;
}

export function parseLayout(text: string): RawLayout {
	if (text.length > 32 * 1024 * 1024) fail('The snapshot exceeds the supported file size.');
	let parsed: unknown;
	try { parsed = JSON.parse(text) as unknown; }
	catch { fail('The snapshot is not valid JSON.'); }
	return validateLayout(parsed);
}

export function cloneLayout(layout: RawLayout): RawLayout {
	return parseLayout(JSON.stringify(validateLayout(layout)));
}
