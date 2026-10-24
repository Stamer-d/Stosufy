// The finished puzzle in 3D: the same pieces as on the board (cut from the same seed), made
// of cardboard with the picture printed on top, on a table under a lamp. They fly in and land
// one by one; it can be turned, zoomed, taken apart, and a piece clicked to make it hop.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { coverBox, jigsawOutlines, seededRandom, type Outline } from './puzzle';

export interface Puzzle3D {
	/** Texture address: the page's own (blob:, data:), not another site's */
	url: string;
	aspect: number;
	cols: number;
	rows: number;
	seed: number;
	/** Jigsaw pieces, or the square tiles of the sliding and spinning puzzles */
	shape: 'jigsaw' | 'tiles';
}

export interface PuzzleScene {
	/** Takes the pieces apart (true) or puts them back together */
	explode(apart: boolean): void;
	setAutoRotate(on: boolean): void;
	resetView(): void;
	resize(width: number, height: number): void;
	dispose(): void;
}

interface Callbacks {
	/** A piece landed (for its knock); `index` is how many landed so far */
	onland?: (index: number) => void;
	/** All pieces are down */
	onassembled?: () => void;
	onhop?: () => void;
	onwhoosh?: (apart: boolean) => void;
}

/** The picture is this wide in the scene */
const SIZE = 10;
const DEPTH = 0.14;
const BEVEL = 0.018;

type Tween = {
	from: THREE.Vector3;
	to: THREE.Vector3;
	fromRot: THREE.Euler;
	toRot: THREE.Euler;
	start: number;
	duration: number;
	/** Lands with a little bounce (else eases in and out) */
	land: boolean;
	done?: () => void;
};

interface Piece {
	pivot: THREE.Group;
	/** Where it lies in the finished puzzle */
	home: THREE.Vector3;
	tween: Tween | null;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
/** Falls faster and faster (gravity), bounces up once a little and settles */
function easeLand(t: number) {
	if (t < 0.7) return (t / 0.7) ** 2;
	return 1 - 0.07 * Math.sin(((t - 0.7) / 0.3) * Math.PI);
}

export async function createPuzzleScene(
	canvas: HTMLCanvasElement,
	puzzle: Puzzle3D,
	callbacks: Callbacks = {}
): Promise<PuzzleScene> {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0d0b12);
	scene.fog = new THREE.Fog(0x0d0b12, 22, 48);

	const width = SIZE;
	const height =
		puzzle.shape === 'jigsaw' ? SIZE / puzzle.aspect : (SIZE * puzzle.rows) / puzzle.cols;

	const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 120);
	const home = new THREE.Vector3(0, Math.max(width, height) * 1.05, Math.max(width, height) * 1.15);
	camera.position.copy(home);

	const controls = new OrbitControls(camera, canvas);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.minDistance = 3;
	controls.maxDistance = 32;
	controls.maxPolarAngle = Math.PI * 0.47;
	controls.autoRotateSpeed = 0.7;
	controls.target.set(0, 0, 0);

	// Light: the sky, a warm lamp with soft shadows, and a coloured light from behind
	scene.add(new THREE.HemisphereLight(0xffffff, 0x2a1f3d, 0.75));
	const lamp = new THREE.DirectionalLight(0xfff2e0, 2.1);
	lamp.position.set(5, 11, 6);
	lamp.castShadow = true;
	lamp.shadow.mapSize.set(2048, 2048);
	lamp.shadow.camera.left = -9;
	lamp.shadow.camera.right = 9;
	lamp.shadow.camera.top = 9;
	lamp.shadow.camera.bottom = -9;
	lamp.shadow.camera.far = 40;
	lamp.shadow.bias = -0.0004;
	lamp.shadow.radius = 4;
	scene.add(lamp);
	const rim = new THREE.PointLight(0x9b6bff, 40, 30, 2);
	rim.position.set(-7, 4, -6);
	scene.add(rim);

	// The table
	const table = new THREE.Mesh(
		new THREE.CircleGeometry(30, 64),
		new THREE.MeshStandardMaterial({ color: 0x1c1826, roughness: 0.95 })
	);
	table.rotation.x = -Math.PI / 2;
	table.position.y = -BEVEL;
	table.receiveShadow = true;
	scene.add(table);

	const texture = await new THREE.TextureLoader().loadAsync(puzzle.url);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

	const face = new THREE.MeshPhysicalMaterial({
		map: texture,
		roughness: 0.42,
		clearcoat: 0.35,
		clearcoatRoughness: 0.4,
		// Always over what's right under it, also with a coarse depth buffer
		polygonOffset: true,
		polygonOffsetFactor: -2,
		polygonOffsetUnits: -2
	});
	const cardboard = new THREE.MeshStandardMaterial({ color: 0xd9cfbd, roughness: 0.9 });
	// The print's edge, a hair larger than the piece, darker: the seams
	const seam = new THREE.MeshBasicMaterial({
		color: 0x07050c,
		polygonOffset: true,
		polygonOffsetFactor: -1,
		polygonOffsetUnits: -1
	});

	// Where on the picture a point of the board is (board 0–1 → texture uv)
	const box = coverBox(puzzle.aspect, puzzle.cols, puzzle.rows);
	const uvOf = (bx: number, by: number): [number, number] =>
		puzzle.shape === 'jigsaw'
			? [bx, 1 - by]
			: [(bx * puzzle.cols - box.x) / box.width, 1 - (by * puzzle.rows - box.y) / box.height];

	// The outlines in the scene's units: x to the right, y up (the picture's top is +y)
	const toScene = ([x, y]: [number, number], unit: number): [number, number] => [
		x * unit - width / 2,
		height / 2 - y * unit
	];
	let outlines: Outline[];
	let unit: number;
	if (puzzle.shape === 'jigsaw') {
		unit = SIZE / 1000;
		outlines = jigsawOutlines(
			puzzle.cols,
			puzzle.rows,
			1000,
			1000 / puzzle.aspect,
			seededRandom(puzzle.seed)
		);
	} else {
		unit = SIZE / puzzle.cols;
		outlines = [];
		for (let r = 0; r < puzzle.rows; r++)
			for (let c = 0; c < puzzle.cols; c++) {
				const corners: [number, number][] = [
					[c, r],
					[c + 1, r],
					[c + 1, r + 1],
					[c, r + 1],
					[c, r]
				];
				outlines.push({
					start: corners[0],
					segments: corners.slice(1).map((p) => [p, p, p] as [typeof p, typeof p, typeof p])
				});
			}
	}

	// The puzzle lies on the table: its plane turned flat, the picture facing up
	const root = new THREE.Group();
	root.rotation.x = -Math.PI / 2;
	scene.add(root);

	const pieces: Piece[] = outlines.map((outline) => {
		const shape = new THREE.Shape();
		const start = toScene(outline.start, unit);
		shape.moveTo(...start);
		for (const [a, b, end] of outline.segments) {
			const [ax, ay] = toScene(a, unit);
			const [bx, by] = toScene(b, unit);
			const [ex, ey] = toScene(end, unit);
			if (a === b && b === end) shape.lineTo(ex, ey);
			else shape.bezierCurveTo(ax, ay, bx, by, ex, ey);
		}
		const bounds = new THREE.Box2().setFromPoints(shape.getPoints(6));
		const center = bounds.getCenter(new THREE.Vector2());

		const body = new THREE.Mesh(
			new THREE.ExtrudeGeometry(shape, {
				depth: DEPTH,
				bevelEnabled: true,
				bevelThickness: BEVEL,
				// The top edge rounds off inwards, under the print: from above only a fine dark
				// seam shows between two pieces, like on a real puzzle
				bevelSize: BEVEL * 0.6,
				bevelOffset: -BEVEL * 0.6,
				bevelSegments: 2,
				curveSegments: 10
			}),
			cardboard
		);
		const top = new THREE.ShapeGeometry(shape, 10);
		const position = top.getAttribute('position');
		const uv = new Float32Array(position.count * 2);
		for (let i = 0; i < position.count; i++) {
			const bx = (position.getX(i) + width / 2) / width;
			const by = (height / 2 - position.getY(i)) / height;
			const [u, v] = uvOf(bx, by);
			uv[i * 2] = u;
			uv[i * 2 + 1] = v;
		}
		top.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
		// A hair smaller than the piece (the picture stays where it was): a fine dark line
		// between the pieces, like on a real puzzle
		top.translate(-center.x, -center.y, 0).scale(0.993, 0.993, 1).translate(center.x, center.y, 0);
		const print = new THREE.Mesh(top, face);
		print.position.z = DEPTH + BEVEL + 0.008;
		// Under the print, a little larger than the piece: neighbours overlap there, so the
		// hairline between two prints shows dark instead of the cardboard below
		const under = new THREE.ShapeGeometry(shape, 10)
			.translate(-center.x, -center.y, 0)
			.scale(1.025, 1.025, 1)
			.translate(center.x, center.y, 0);
		const gap = new THREE.Mesh(under, seam);
		gap.position.z = DEPTH + BEVEL + 0.004;
		for (const mesh of [body, print, gap]) {
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			// The piece turns around its own middle
			mesh.position.x -= center.x;
			mesh.position.y -= center.y;
		}
		const pivot = new THREE.Group();
		pivot.add(body, gap, print);
		const homePosition = new THREE.Vector3(center.x, center.y, 0);
		pivot.position.copy(homePosition);
		root.add(pivot);
		return { pivot, home: homePosition, tween: null };
	});

	// --- Movement ---------------------------------------------------------------------------

	const now = () => performance.now() / 1000;

	function tweenTo(
		piece: Piece,
		to: THREE.Vector3,
		toRot: THREE.Euler,
		{ delay = 0, duration = 0.7, land = false, done = undefined as (() => void) | undefined } = {}
	) {
		piece.tween = {
			from: piece.pivot.position.clone(),
			to,
			fromRot: piece.pivot.rotation.clone(),
			toRot,
			start: now() + delay,
			duration,
			land,
			done
		};
	}

	function step(piece: Piece, time: number) {
		const tween = piece.tween;
		if (!tween) return;
		const t = Math.min(1, Math.max(0, (time - tween.start) / tween.duration));
		if (time < tween.start) return;
		const e = tween.land ? easeLand(t) : easeInOutCubic(t);
		const flat = tween.land ? easeOutCubic(Math.min(1, t * 1.25)) : e;
		const p = piece.pivot.position;
		p.x = tween.from.x + (tween.to.x - tween.from.x) * flat;
		p.y = tween.from.y + (tween.to.y - tween.from.y) * flat;
		p.z = tween.from.z + (tween.to.z - tween.from.z) * e;
		const r = piece.pivot.rotation;
		r.x = tween.fromRot.x + (tween.toRot.x - tween.fromRot.x) * flat;
		r.y = tween.fromRot.y + (tween.toRot.y - tween.fromRot.y) * flat;
		r.z = tween.fromRot.z + (tween.toRot.z - tween.fromRot.z) * flat;
		if (t >= 1) {
			piece.tween = null;
			tween.done?.();
		}
	}

	const flat = () => new THREE.Euler(0, 0, 0);
	const random = seededRandom(puzzle.seed ^ 0x5eed);

	// The pieces fly in from above and land one after another, the middle first
	const order = [...pieces].sort(
		(a, b) => a.home.length() + random() * 3 - (b.home.length() + random() * 3)
	);
	const spread = 1.4 + Math.min(1.6, pieces.length / 120);
	let landed = 0;
	order.forEach((piece, i) => {
		piece.pivot.position.set(
			piece.home.x * 1.6 + (random() - 0.5) * 6,
			piece.home.y * 1.6 + (random() - 0.5) * 6,
			5 + random() * 6
		);
		piece.pivot.rotation.set((random() - 0.5) * 3, (random() - 0.5) * 3, (random() - 0.5) * 4);
		tweenTo(piece, piece.home.clone(), flat(), {
			delay: 0.25 + (i / order.length) * spread,
			duration: 0.8,
			land: true,
			done: () => {
				landed++;
				callbacks.onland?.(landed);
				if (landed === pieces.length) {
					callbacks.onassembled?.();
					controls.autoRotate = autoRotate;
				}
			}
		});
	});

	let autoRotate = true;
	let apart = false;

	function explode(on: boolean) {
		apart = on;
		callbacks.onwhoosh?.(on);
		const far = Math.hypot(width, height) / 2;
		pieces.forEach((piece) => {
			const out = piece.home.clone();
			const distance = out.length() / far;
			const to = on
				? new THREE.Vector3(
						piece.home.x * (1.25 + random() * 0.15),
						piece.home.y * (1.25 + random() * 0.15),
						0.8 + (1 - distance) * 1.6 + random() * 0.8
					)
				: piece.home.clone();
			const rot = on
				? new THREE.Euler((random() - 0.5) * 0.6, (random() - 0.5) * 0.6, (random() - 0.5) * 0.8)
				: flat();
			tweenTo(piece, to, rot, { delay: distance * 0.15, duration: 0.75, land: !on });
		});
	}

	// A click on a piece (not a drag): it hops
	const raycaster = new THREE.Raycaster();
	let down: { x: number; y: number } | null = null;
	const onDown = (event: PointerEvent) => (down = { x: event.clientX, y: event.clientY });
	const onUp = (event: PointerEvent) => {
		if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
		down = null;
		const rect = canvas.getBoundingClientRect();
		const pointer = new THREE.Vector2(
			((event.clientX - rect.left) / rect.width) * 2 - 1,
			-((event.clientY - rect.top) / rect.height) * 2 + 1
		);
		raycaster.setFromCamera(pointer, camera);
		const hit = raycaster.intersectObjects(root.children, true)[0];
		const piece = hit && pieces.find((p) => p.pivot === hit.object.parent);
		if (!piece || piece.tween) return;
		const restZ = piece.pivot.position.z;
		const rest = piece.pivot.rotation.clone();
		callbacks.onhop?.();
		tweenTo(
			piece,
			piece.pivot.position.clone().setZ(restZ + 1.4),
			new THREE.Euler(rest.x, rest.y, rest.z + Math.PI),
			{
				duration: 0.32,
				done: () =>
					tweenTo(
						piece,
						piece.pivot.position.clone().setZ(restZ),
						new THREE.Euler(rest.x, rest.y, rest.z + Math.PI * 2),
						{
							duration: 0.45,
							land: true,
							done: () => {
								piece.pivot.rotation.copy(rest);
								callbacks.onland?.(-1);
							}
						}
					)
			}
		);
	};
	canvas.addEventListener('pointerdown', onDown);
	canvas.addEventListener('pointerup', onUp);

	let frame = 0;
	const render = () => {
		frame = requestAnimationFrame(render);
		const time = now();
		for (const piece of pieces) step(piece, time);
		controls.update();
		renderer.render(scene, camera);
	};
	render();

	return {
		explode,
		setAutoRotate(on) {
			autoRotate = on;
			if (landed === pieces.length) controls.autoRotate = on;
		},
		resetView() {
			camera.position.copy(home);
			controls.target.set(0, 0, 0);
			if (apart) explode(false);
		},
		resize(w, h) {
			renderer.setSize(w, h, false);
			camera.aspect = w / Math.max(1, h);
			camera.updateProjectionMatrix();
		},
		dispose() {
			cancelAnimationFrame(frame);
			canvas.removeEventListener('pointerdown', onDown);
			canvas.removeEventListener('pointerup', onUp);
			controls.dispose();
			scene.traverse((object) => {
				if (object instanceof THREE.Mesh) object.geometry.dispose();
			});
			face.dispose();
			cardboard.dispose();
			seam.dispose();
			texture.dispose();
			renderer.dispose();
		}
	};
}
