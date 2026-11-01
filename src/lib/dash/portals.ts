import type { Portal, Section } from './physics';

/** Visual events share the exact activation plane used by the section timeline. */
export function sectionPortals(before: Section | undefined, section: Section, y: number): Portal[] {
	if (!before) return [];
	const common = { x: section.x0, y, x0: section.x0 - 1, x1: section.x0 + 1 };
	const result: Portal[] = [];
	if (before.mode !== section.mode) result.push({ ...common, kind: 'mode', mode: section.mode });
	if (before.mini !== section.mini) result.push({ ...common, kind: 'size', mini: section.mini });
	if (before.speedIndex !== section.speedIndex)
		result.push({ ...common, kind: 'speed', speedIndex: section.speedIndex });
	return result;
}
