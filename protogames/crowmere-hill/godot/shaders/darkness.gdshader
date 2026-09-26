// The cellar's candle circle: everything outside radius r1 is black, the ring
// between r0 and r1 is ordered-dithered -- the same 4x4 Bayer rule as the web
// build's software renderer (web/src/world.js darkness()).
shader_type canvas_item;

uniform bool enabled = false;
uniform vec2 center = vec2(160.0, 84.0);   // picture pixels
uniform float r0 = 36.0;
uniform float r1 = 66.0;

const float BAYER[16] = float[](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);

void fragment() {
	if (!enabled) { discard; }
	vec2 p = floor(UV * vec2(320.0, 168.0));
	float dx = p.x - center.x;
	float dy = (p.y - center.y) * 1.2;
	float d = sqrt(dx * dx + dy * dy);
	if (d <= r0) { discard; }
	int bi = int(mod(p.y, 4.0)) * 4 + int(mod(p.x, 4.0));
	float t = (BAYER[bi] + 0.5) / 16.0;
	if (d >= r1 || (d - r0) / (r1 - r0) > t) {
		COLOR = vec4(0.0, 0.0, 0.0, 1.0);
	} else {
		discard;
	}
}
