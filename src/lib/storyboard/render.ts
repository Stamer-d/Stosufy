// Draws a parsed storyboard with WebGL at a given time of the song

import { ease } from './easing';
import { framePath, type Command, type Storyboard, type StoryboardSprite } from './parse';

/** Storyboard coordinates: 640x480, widened to 854x480 on wide screens */
const HEIGHT = 480;
const WIDE = 854;
const DRAW_ORDER = ['Background', 'Fail', 'Pass', 'Foreground', 'Overlay'].filter(
	// A music player has no failing: the "Pass" state is shown
	(layer) => layer !== 'Fail'
);

const VERTEX = `
attribute vec2 a_corner;
uniform mat3 u_matrix;
uniform vec2 u_flip;
varying vec2 v_uv;
void main() {
	v_uv = mix(a_corner, 1.0 - a_corner, u_flip);
	vec3 position = u_matrix * vec3(a_corner, 1.0);
	gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const FRAGMENT = `
precision mediump float;
uniform sampler2D u_texture;
uniform vec4 u_color;
varying vec2 v_uv;
void main() {
	vec4 texel = texture2D(u_texture, v_uv);
	gl_FragColor = vec4(texel.rgb * u_color.rgb, texel.a * u_color.a);
}`;

/** The value of a command type at a time: eased within a command, held between them */
function valueAt(commands: Command[] | undefined, time: number, fallback: number[]): number[] {
	if (!commands?.length) return fallback;
	if (time < commands[0].start) return commands[0].from;
	let current = commands[0];
	for (const command of commands) {
		if (command.start > time) break;
		current = command;
	}
	if (time >= current.end) return current.to;
	const progress = ease(current.easing, (time - current.start) / (current.end - current.start));
	return current.from.map((from, i) => from + (current.to[i] - from) * progress);
}

function parameterActive(sprite: StoryboardSprite, type: 'H' | 'V' | 'A', time: number) {
	return sprite.parameters.some(
		(p) => p.type === type && (p.start === p.end || (time >= p.start && time <= p.end))
	);
}

export interface StoryboardRenderer {
	/** Draws the storyboard at a time of the song (ms) */
	draw(time: number): void;
	destroy(): void;
}

/**
 * Sets up drawing a storyboard on a canvas. `loadImage` returns the decoded image of a
 * path relative to the beatmap folder, or null if it is missing.
 */
export function createRenderer(
	canvas: HTMLCanvasElement,
	storyboard: Storyboard,
	loadImage: (path: string) => Promise<ImageBitmap | null>
): StoryboardRenderer | null {
	const gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
	if (!gl) return null;

	const compile = (type: number, source: string) => {
		const shader = gl.createShader(type);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		return shader;
	};
	const program = gl.createProgram();
	gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
	gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
	gl.linkProgram(program);
	gl.useProgram(program);
	const corners = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, corners);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
		gl.STATIC_DRAW
	);
	const cornerLocation = gl.getAttribLocation(program, 'a_corner');
	gl.enableVertexAttribArray(cornerLocation);
	gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0);
	const u = {
		matrix: gl.getUniformLocation(program, 'u_matrix'),
		flip: gl.getUniformLocation(program, 'u_flip'),
		color: gl.getUniformLocation(program, 'u_color')
	};
	gl.enable(gl.BLEND);

	// Textures load in the background; sprites appear once theirs is ready
	const textures = new Map<
		string,
		{ texture: WebGLTexture; width: number; height: number } | null
	>();
	let destroyed = false;
	for (const path of storyboard.images) {
		textures.set(path, null);
		loadImage(path).then((image) => {
			if (!image || destroyed) return;
			const texture = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			textures.set(path, { texture, width: image.width, height: image.height });
			image.close();
		});
	}

	const layers = DRAW_ORDER.map((layer) => storyboard.sprites.filter((s) => s.layer === layer));

	function draw(time: number) {
		const width = Math.round(canvas.clientWidth * devicePixelRatio);
		const height = Math.round(canvas.clientHeight * devicePixelRatio);
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		gl.viewport(0, 0, width, height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		if (!width || !height) return;

		// Fill the canvas like a cover image: storyboard units to clip space
		const scale = Math.max(width / WIDE, height / HEIGHT);
		const sx = (2 * scale) / width;
		const sy = (-2 * scale) / height;
		// Storyboard x = 320 / y = 240 is the middle of the canvas
		const ox = -320 * sx;
		const oy = -240 * sy;

		for (const sprites of layers) {
			for (const sprite of sprites) {
				if (time < sprite.start || time > sprite.end) continue;
				const [opacity] = valueAt(sprite.commands.F, time, [1]);
				if (opacity <= 0.001) continue;

				let path = sprite.path;
				if (sprite.animation) {
					const { frames, delay, loop } = sprite.animation;
					const frame = Math.floor(Math.max(0, time - sprite.start) / delay);
					path = framePath(sprite.path, loop ? frame % frames : Math.min(frame, frames - 1));
				}
				const image = textures.get(path);
				if (!image) continue;

				const [mx, my] = valueAt(sprite.commands.M, time, [sprite.x, sprite.y]);
				const x = sprite.commands.MX ? valueAt(sprite.commands.MX, time, [mx])[0] : mx;
				const y = sprite.commands.MY ? valueAt(sprite.commands.MY, time, [my])[0] : my;
				const [scaleAll] = valueAt(sprite.commands.S, time, [1]);
				const [vx, vy] = valueAt(sprite.commands.V, time, [1, 1]);
				const [rotation] = valueAt(sprite.commands.R, time, [0]);
				const [r, g, b] = valueAt(sprite.commands.C, time, [255, 255, 255]);
				const w = image.width * scaleAll * vx;
				const h = image.height * scaleAll * vy;
				if (w === 0 || h === 0) continue;

				// corner (0..1) -> image box around the origin -> rotation -> position -> clip
				const cos = Math.cos(rotation);
				const sin = Math.sin(rotation);
				const left = -sprite.origin[0] * w;
				const top = -sprite.origin[1] * h;
				const a = cos * w;
				const bb = sin * w;
				const c = -sin * h;
				const d = cos * h;
				const tx = cos * left - sin * top + x;
				const ty = sin * left + cos * top + y;
				gl.uniformMatrix3fv(
					u.matrix,
					false,
					new Float32Array([a * sx, bb * sy, 0, c * sx, d * sy, 0, tx * sx + ox, ty * sy + oy, 1])
				);
				gl.uniform2f(
					u.flip,
					parameterActive(sprite, 'H', time) ? 1 : 0,
					parameterActive(sprite, 'V', time) ? 1 : 0
				);
				gl.uniform4f(u.color, r / 255, g / 255, b / 255, Math.min(1, opacity));
				if (parameterActive(sprite, 'A', time)) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
				else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
				gl.bindTexture(gl.TEXTURE_2D, image.texture);
				gl.drawArrays(gl.TRIANGLES, 0, 6);
			}
		}
	}

	return {
		draw,
		destroy() {
			destroyed = true;
			for (const entry of textures.values()) if (entry) gl.deleteTexture(entry.texture);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		}
	};
}
