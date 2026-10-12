<script>
	// A Skew-T diagram of the forecast sounding: temperature (red), dew point (green) and the
	// path of a parcel rising from the ground (dashed), with the cloud base
	/** @type {{ profile: import('#lib/storm.ts').StormProfile, width?: number, height?: number }} */
	let { profile, width = 300, height = 300 } = $props();

	const TOP = 200;
	const BOTTOM = 1050;
	const T_MIN = -40;
	const T_MAX = 45;
	const SKEW = 0.7;
	const y = (p) => ((Math.log(BOTTOM) - Math.log(p)) / (Math.log(BOTTOM) - Math.log(TOP))) * height;
	const x = (t, p) => ((t - T_MIN) / (T_MAX - T_MIN)) * width + (height - y(p)) * SKEW;

	// The parcel: dry adiabat to the cloud base, then saturated (moist) adiabat
	let parcel = $derived.by(() => {
		const s = profile.surface;
		const T0 = s.t + 273.15;
		const Td = s.td + 273.15;
		const Tl = 1 / (1 / (Td - 56) + Math.log(T0 / Td) / 800) + 56;
		const pl = s.p * (Tl / T0) ** (1 / 0.2857);
		const points = [];
		for (let p = s.p; p > pl; p -= 10) points.push([T0 * (p / s.p) ** 0.2857 - 273.15, p]);
		let T = Tl;
		points.push([T - 273.15, pl]);
		const es = (t) => 6.112 * Math.exp((17.67 * (t - 273.15)) / (t - 29.65));
		for (let p = pl; p > TOP; p -= 5) {
			const rs = (0.622 * es(T)) / (p - es(T));
			const dTdp =
				(287 * T + 2.5e6 * rs) / (p * (1004 + (2.5e6 * 2.5e6 * rs * 0.622) / (287 * T * T)));
			T -= dTdp * 5;
			points.push([T - 273.15, p - 5]);
		}
		return { points, lcl: pl };
	});
	const path = (list) =>
		list.map(([t, p], i) => `${i ? 'L' : 'M'}${x(t, p).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
	let temperature = $derived(path(profile.levels.map((l) => [l.t, l.p])));
	let dew = $derived(path(profile.levels.map((l) => [l.td, l.p])));
</script>

<svg
	{width}
	{height}
	viewBox="0 0 {width} {height}"
	class="block overflow-hidden rounded-lg bg-black/30"
>
	<defs>
		<clipPath id="skewt-clip"><rect {width} {height} /></clipPath>
	</defs>
	<g clip-path="url(#skewt-clip)">
		<!-- Isotherms, 0 °C stronger -->
		{#each Array.from({ length: 16 }, (_, i) => -110 + i * 10) as t (t)}
			<line
				x1={x(t, BOTTOM)}
				y1={y(BOTTOM)}
				x2={x(t, TOP)}
				y2={y(TOP)}
				stroke={t === 0 ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.08)'}
			/>
		{/each}
		{#each [1000, 850, 700, 500, 300, 200] as p (p)}
			<line x1="0" y1={y(p)} x2={width} y2={y(p)} stroke="rgba(255,255,255,0.12)" />
			<text x="3" y={y(p) - 2} font-size="9" fill="rgba(255,255,255,0.45)">{p}</text>
		{/each}
		<path
			d={path(parcel.points)}
			fill="none"
			stroke="rgba(255,255,255,0.7)"
			stroke-width="1.5"
			stroke-dasharray="4 3"
		/>
		<path d={temperature} fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linejoin="round" />
		<path d={dew} fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linejoin="round" />
		<!-- Cloud base -->
		<line
			x1={width - 46}
			y1={y(parcel.lcl)}
			x2={width - 4}
			y2={y(parcel.lcl)}
			stroke="#e5e7eb"
			stroke-width="2"
		/>
		<text
			x={width - 6}
			y={y(parcel.lcl) - 3}
			font-size="9"
			font-weight="700"
			fill="#e5e7eb"
			text-anchor="end">LCL</text
		>
	</g>
	<text x={width - 6} y={height - 6} font-size="9" fill="rgba(255,255,255,0.45)" text-anchor="end"
		>hPa · °C</text
	>
</svg>
