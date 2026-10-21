<script>
	// What's written on a forecast map, to read it at a glance: the values spread over the map
	// (with the wind's direction as an arrow), and the pressure's lines (isobars) with the highs
	// and lows. The values sit on fixed places of the map, so they move with it.
	import {
		valuesAt,
		valueAt,
		smooth,
		isolines,
		extremes,
		gridOnScreen,
		onGrid
	} from '#lib/weatherField.ts';
	import { fromWorldPixel, worldPixel, TILE } from '#lib/map.ts';
	import { windCss } from '#lib/weather.ts';
	import { limit } from '#lib/weatherLayers.ts';

	/**
	 * @type {{
	 *   grid: import('#lib/weather.ts').WeatherGrid | null,
	 *   layer: import('#lib/weatherLayers.ts').MapLayer | null,
	 *   time: number,
	 *   labels?: boolean,
	 *   isobars?: boolean,
	 *   lat: number, lon: number, zoom: number, width: number, height: number
	 * }}
	 */
	let {
		grid,
		layer,
		time,
		labels = true,
		isobars = false,
		lat,
		lon,
		zoom,
		width,
		height
	} = $props();

	let canvas = $state();
	const FONT = 'Figtree Variable, ui-sans-serif, system-ui, sans-serif';

	function pill(c, x, y, w, h, fill) {
		c.fillStyle = fill;
		c.beginPath();
		c.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
		c.fill();
	}

	/** An arrow pointing the way the wind blows (degrees from north) */
	function arrow(c, x, y, towards, size, colour) {
		c.save();
		c.translate(x, y);
		c.rotate((towards * Math.PI) / 180);
		c.fillStyle = colour;
		c.beginPath();
		c.moveTo(0, -size);
		c.lineTo(size * 0.72, size * 0.78);
		c.lineTo(0, size * 0.36);
		c.lineTo(-size * 0.72, size * 0.78);
		c.closePath();
		c.fill();
		c.restore();
	}

	function drawIsobars(c, view) {
		const values = valuesAt(grid, 'pressure', time);
		if (!values) return;
		const cell = (grid.step / 360) * TILE * 2 ** zoom;
		const raster = smooth(
			values,
			grid.columns,
			grid.rows,
			Math.max(2, Math.min(10, Math.ceil(cell / 14)))
		);
		const { xs, ys } = gridOnScreen(grid, view, raster);
		const sx = (fx) => {
			const i = Math.min(xs.length - 2, Math.floor(fx));
			return xs[i] + (xs[i + 1] - xs[i]) * (fx - i);
		};
		const sy = (fy) => {
			const i = Math.min(ys.length - 2, Math.floor(fy));
			return ys[i] + (ys[i + 1] - ys[i]) * (fy - i);
		};
		let min = Infinity;
		let max = -Infinity;
		for (const value of values) {
			if (value < min) min = value;
			if (value > max) max = value;
		}
		const every = zoom >= 8 ? 2 : 4;
		const placed = [];
		const far = (x, y, distance) => placed.every((p) => Math.hypot(p.x - x, p.y - y) > distance);
		const tags = [];
		c.lineJoin = 'round';
		for (let level = Math.ceil(min / every) * every; level <= max; level += every) {
			const segments = isolines(raster, level);
			if (!segments.length) continue;
			c.strokeStyle = 'rgba(255, 255, 255, 0.62)';
			c.lineWidth = level % 20 === 0 ? 2 : 1.2;
			c.beginPath();
			for (let k = 0; k < segments.length; k += 4) {
				c.moveTo(sx(segments[k]), sy(segments[k + 1]));
				c.lineTo(sx(segments[k + 2]), sy(segments[k + 3]));
			}
			c.stroke();
			// Its value on it, twice at most, apart from the others
			let count = 0;
			const stride = Math.max(4, Math.floor(segments.length / 4 / 7)) * 4;
			for (let k = 0; k < segments.length && count < 2; k += stride) {
				const x = sx((segments[k] + segments[k + 2]) / 2);
				const y = sy((segments[k + 1] + segments[k + 3]) / 2);
				if (x < 50 || y < 70 || x > width - 50 || y > height - 90 || !far(x, y, 210)) continue;
				placed.push({ x, y });
				tags.push({ x, y, text: `${level}` });
				count++;
			}
		}
		c.font = `700 10px ${FONT}`;
		c.textAlign = 'center';
		c.textBaseline = 'middle';
		for (const tag of tags) {
			pill(c, tag.x, tag.y, c.measureText(tag.text).width + 10, 16, 'rgba(14, 17, 22, 0.85)');
			c.fillStyle = 'rgba(255, 255, 255, 0.9)';
			c.fillText(tag.text, tag.x, tag.y + 0.5);
		}
		// Highs and lows
		const toScreen = (gx, gy) => {
			const p = worldPixel(grid.north - gy * grid.latStep, grid.west + gx * grid.step, zoom);
			const centre = worldPixel(lat, lon, zoom);
			const world = TILE * 2 ** zoom;
			let x = p.x - centre.x + width / 2;
			x -= Math.round((x - width / 2) / world) * world;
			return { x, y: p.y - centre.y + height / 2 };
		};
		for (const point of extremes(values, grid.columns, grid.rows)) {
			const { x, y } = toScreen(point.gx, point.gy);
			if (x < 20 || y < 20 || x > width - 20 || y > height - 20) continue;
			c.font = `800 28px ${FONT}`;
			c.lineWidth = 4;
			c.strokeStyle = 'rgba(10, 12, 16, 0.75)';
			c.strokeText(point.high ? 'H' : 'L', x, y);
			c.fillStyle = point.high ? '#7dd3fc' : '#fda4af';
			c.fillText(point.high ? 'H' : 'L', x, y);
			c.font = `700 11px ${FONT}`;
			c.lineWidth = 3;
			c.strokeText(`${Math.round(point.value)}`, x, y + 20);
			c.fillStyle = 'rgba(255, 255, 255, 0.92)';
			c.fillText(`${Math.round(point.value)}`, x, y + 20);
		}
	}

	function drawValues(c) {
		const values = valuesAt(grid, layer.key, time);
		if (!values) return;
		const u = layer.arrows ? valuesAt(grid, 'u', time) : null;
		const v = layer.arrows ? valuesAt(grid, 'v', time) : null;
		const spaceX = layer.arrows ? 118 : 98;
		const spaceY = 78;
		const centre = worldPixel(lat, lon, zoom);
		const left = centre.x - width / 2;
		const top = centre.y - height / 2;
		c.font = `700 12px ${FONT}`;
		c.textAlign = 'center';
		c.textBaseline = 'middle';
		for (let j = Math.floor(top / spaceY); j <= Math.ceil((top + height) / spaceY); j++) {
			const shift = (((j % 2) + 2) % 2) * (spaceX / 2);
			for (
				let i = Math.floor((left - shift) / spaceX);
				i <= Math.ceil((left + width - shift) / spaceX);
				i++
			) {
				const wx = i * spaceX + shift;
				const wy = j * spaceY;
				const x = wx - left;
				const y = wy - top;
				// Not under the controls at the map's edges
				if (x < 24 || y < 64 || x > width - 24 || y > height - 24) continue;
				const place = fromWorldPixel(wx, wy, zoom);
				const at = onGrid(grid, place.lat, place.lon);
				if (!at) continue;
				const value = limit(layer.key, valueAt(values, grid.columns, grid.rows, at.gx, at.gy));
				const text = layer.text(value);
				if (!text) continue;
				const tw = c.measureText(text).width;
				if (u && v) {
					const ue = valueAt(u, grid.columns, grid.rows, at.gx, at.gy);
					const ve = valueAt(v, grid.columns, grid.rows, at.gx, at.gy);
					const towards = (Math.atan2(ue, ve) * 180) / Math.PI;
					const w = tw + 32;
					pill(c, x, y, w, 22, 'rgba(12, 14, 18, 0.74)');
					c.beginPath();
					c.arc(x - w / 2 + 11, y, 8, 0, Math.PI * 2);
					c.fillStyle = windCss(value);
					c.fill();
					arrow(c, x - w / 2 + 11, y, towards, 5.5, 'rgba(10, 12, 16, 0.9)');
					c.fillStyle = '#ffffff';
					c.fillText(text, x + 8, y + 0.5);
				} else {
					pill(c, x, y, tw + 14, 21, 'rgba(12, 14, 18, 0.7)');
					c.fillStyle = '#ffffff';
					c.fillText(text, x, y + 0.5);
				}
			}
		}
	}

	$effect(() => {
		if (!canvas) return;
		const ratio = devicePixelRatio || 1;
		const cw = Math.ceil(width * ratio);
		const ch = Math.ceil(height * ratio);
		if (canvas.width !== cw) canvas.width = cw;
		if (canvas.height !== ch) canvas.height = ch;
		const c = canvas.getContext('2d');
		c.setTransform(1, 0, 0, 1, 0, 0);
		c.clearRect(0, 0, cw, ch);
		if (!grid || !width || !height) return;
		c.setTransform(ratio, 0, 0, ratio, 0, 0);
		if (isobars || layer?.isobars) drawIsobars(c, { lat, lon, zoom, width, height });
		if (labels && layer) drawValues(c);
	});
</script>

<canvas bind:this={canvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
