import { Snapshot } from './backups';
import { RawLayout, validateLayout } from './layout';

export interface OperationPort<T> {
	checkCompatibility(): boolean | Promise<boolean>;
	isTargetCurrent(target: T): boolean;
	isAcknowledged(): boolean;
	requestConsent(): Promise<boolean>;
	persistAcknowledgement(): Promise<void>;
	captureLayout(): RawLayout;
	captureRevision(): unknown;
	isRevisionCurrent(token: unknown): boolean;
	createBackup(layout: RawLayout, reason: string): Promise<Snapshot>;
	loadBackup(snapshot: Snapshot): Promise<RawLayout>;
	confirmFullRestore(snapshot: Snapshot): Promise<boolean>;
	addColumn(target: T): void | Promise<void>;
	addRow(target: T): void | Promise<void>;
	split(target: T): void | Promise<void>;
	collapse(target: T): void | Promise<void>;
	applyFullLayout(layout: RawLayout): Promise<void>;
}

export type OperationStatus = 'success' | 'cancelled' | 'blocked' | 'stale' | 'error';
export interface OperationResult {
	status: OperationStatus;
	message: string;
	snapshot?: Snapshot;
}

function result(status: OperationStatus, message: string, snapshot?: Snapshot): OperationResult {
	return snapshot ? { status, message, snapshot } : { status, message };
}

/** Owns asynchronous safety boundaries; live mutation and narrow rollback belong to the adapter. */
export class OperationService<T> {
	private running = false;
	private disposed = false;
	private generation = 0;
	constructor(private readonly port: OperationPort<T>) {}
	get busy(): boolean { return this.running; }
	dispose(): void { this.disposed = true; this.generation++; }
	addColumn(target: T): Promise<OperationResult> { return this.run('addColumn', target); }
	addRow(target: T): Promise<OperationResult> { return this.run('addRow', target); }
	split(target: T): Promise<OperationResult> { return this.run('split', target); }
	collapse(target: T): Promise<OperationResult> { return this.run('collapse', target); }

	private alive(generation: number): boolean { return !this.disposed && generation === this.generation; }
	private unavailable(): OperationResult { return result('blocked', 'The plugin was disabled before the operation could finish.'); }
	private stale(): OperationResult { return result('stale', 'The workspace changed. Select the sidebar tab again and retry.'); }
	private async consent(generation: number): Promise<boolean> {
		if (this.port.isAcknowledged()) return true;
		if (!await this.port.requestConsent() || !this.alive(generation)) return false;
		await this.port.persistAcknowledgement();
		return this.alive(generation);
	}

	private exclusive(work: (generation: number) => Promise<OperationResult>): Promise<OperationResult> {
		if (this.disposed) return Promise.resolve(this.unavailable());
		if (this.running) return Promise.resolve(result('blocked', 'Another sidebar operation is already in progress.'));
		this.running = true;
		const generation = this.generation;
		return work(generation).catch((error: unknown) => result('error', error instanceof Error ? error.message : 'The sidebar operation failed.')).finally(() => { this.running = false; });
	}

	private run(action: 'addColumn' | 'addRow' | 'split' | 'collapse', target: T): Promise<OperationResult> {
		return this.exclusive(async generation => {
			if (!await this.port.checkCompatibility()) return result('blocked', 'This Obsidian version or workspace structure is not enabled for experimental sidebar columns.');
			if (!this.alive(generation)) return this.unavailable();
			if (!this.port.isTargetCurrent(target)) return this.stale();
			if (!await this.consent(generation)) return this.alive(generation) ? result('cancelled', 'No layout changes were made.') : this.unavailable();
			if (!this.alive(generation)) return this.unavailable();
			if (!this.port.isTargetCurrent(target)) return this.stale();
			const revision = this.port.captureRevision();
			const layout = validateLayout(this.port.captureLayout());
			const backupReason = {
				addColumn: 'before-add-column', addRow: 'before-add-row', split: 'before-split', collapse: 'before-collapse'
			}[action];
			const snapshot = await this.port.createBackup(layout, backupReason);
			if (!this.alive(generation)) return this.unavailable();
			if (!this.port.isRevisionCurrent(revision) || !this.port.isTargetCurrent(target)) return this.stale();
			await this.port[action](target);
			const successMessage = {
				addColumn: 'An empty full-height sidebar column was added.',
				addRow: 'An empty full-width bottom sidebar row was added.',
				split: 'An empty column was added beside this row.',
				collapse: 'The sidebar column was collapsed.'
			}[action];
			return result('success', successMessage, snapshot);
		});
	}

	restore(snapshot: Snapshot): Promise<OperationResult> {
		return this.exclusive(async generation => {
			if (!await this.port.checkCompatibility()) return result('blocked', 'Restoration is unavailable for this Obsidian version or workspace structure.');
			if (!this.alive(generation)) return this.unavailable();
			const layout = validateLayout(await this.port.loadBackup(snapshot));
			if (!this.alive(generation)) return this.unavailable();
			if (!await this.port.confirmFullRestore(snapshot)) return result('cancelled', 'The workspace was not restored.');
			if (!this.alive(generation)) return this.unavailable();
			if (!await this.consent(generation)) return this.alive(generation) ? result('cancelled', 'The workspace was not restored.') : this.unavailable();
			if (!this.alive(generation)) return this.unavailable();
			const revision = this.port.captureRevision();
			const current = validateLayout(this.port.captureLayout());
			const beforeRestore = await this.port.createBackup(current, 'pre-restore');
			if (!this.alive(generation)) return this.unavailable();
			if (!this.port.isRevisionCurrent(revision)) return this.stale();
			await this.port.applyFullLayout(layout);
			return result('success', 'The full workspace layout was restored.', beforeRestore);
		});
	}
}
