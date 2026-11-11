import type { Hazard, World } from './physics';

/** Final-world validation: repairs can remove a support far from the collision point. */
export function unsupportedSpikes(world: World): Hazard[] {
	return world.hazards.items.filter(
		(h) => h.kind !== 'saw' && !world.surfaceAt(h.x - 0.45, h.x + 0.45, h.y, h.dir)
	);
}

export function removeUnsupportedSpikes(world: World) {
	const unsupported = new Set(unsupportedSpikes(world));
	world.hazards.removeIf((h) => unsupported.has(h));
	return unsupported.size;
}
