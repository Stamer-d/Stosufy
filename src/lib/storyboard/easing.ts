// The 35 easings of osu! storyboards, by their number in the storyboard script

type Easing = (t: number) => number;

const reverse =
	(f: Easing): Easing =>
	(t) =>
		1 - f(1 - t);
const inOut =
	(f: Easing): Easing =>
	(t) =>
		t < 0.5 ? f(2 * t) / 2 : 1 - f(2 - 2 * t) / 2;

const quad: Easing = (t) => t * t;
const cubic: Easing = (t) => t ** 3;
const quart: Easing = (t) => t ** 4;
const quint: Easing = (t) => t ** 5;
const sine: Easing = (t) => 1 - Math.cos((t * Math.PI) / 2);
const expo: Easing = (t) => (t === 0 ? 0 : 2 ** (10 * (t - 1)));
const circ: Easing = (t) => 1 - Math.sqrt(1 - t * t);
const elastic: Easing = (t) =>
	t === 0 || t === 1 ? t : -(2 ** (10 * (t - 1))) * Math.sin(((t - 1.075) * 2 * Math.PI) / 0.3);
const back: Easing = (t) => t * t * (2.70158 * t - 1.70158);
const bounceOut: Easing = (t) => {
	if (t < 1 / 2.75) return 7.5625 * t * t;
	if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
	if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
	return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
};
const elasticOut =
	(period: number): Easing =>
	(t) =>
		t === 0 || t === 1
			? t
			: 2 ** (-10 * t) * Math.sin(((t - period / 4) * 2 * Math.PI) / period) + 1;

export const EASINGS: Easing[] = [
	(t) => t, // 0 Linear
	(t) => 1 - (1 - t) * (1 - t), // 1 Easing Out (decelerating)
	quad, // 2 Easing In (accelerating)
	quad, // 3 InQuad
	reverse(quad), // 4 OutQuad
	inOut(quad), // 5 InOutQuad
	cubic, // 6 InCubic
	reverse(cubic), // 7 OutCubic
	inOut(cubic), // 8 InOutCubic
	quart, // 9 InQuart
	reverse(quart), // 10 OutQuart
	inOut(quart), // 11 InOutQuart
	quint, // 12 InQuint
	reverse(quint), // 13 OutQuint
	inOut(quint), // 14 InOutQuint
	sine, // 15 InSine
	reverse(sine), // 16 OutSine
	inOut(sine), // 17 InOutSine
	expo, // 18 InExpo
	reverse(expo), // 19 OutExpo
	inOut(expo), // 20 InOutExpo
	circ, // 21 InCirc
	reverse(circ), // 22 OutCirc
	inOut(circ), // 23 InOutCirc
	elastic, // 24 InElastic
	elasticOut(0.3), // 25 OutElastic
	elasticOut(0.6), // 26 OutElasticHalf
	elasticOut(0.15), // 27 OutElasticQuarter
	inOut(elastic), // 28 InOutElastic
	back, // 29 InBack
	reverse(back), // 30 OutBack
	inOut((t) => t * t * (3.5949095 * t - 2.5949095)), // 31 InOutBack
	reverse(bounceOut), // 32 InBounce
	bounceOut, // 33 OutBounce
	inOut(reverse(bounceOut)) // 34 InOutBounce
];

export function ease(easing: number, t: number) {
	return (EASINGS[easing] ?? EASINGS[0])(Math.min(1, Math.max(0, t)));
}
