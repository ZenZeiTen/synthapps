// Lightning over Crowmere Hill: only sky pixels (scene depth 255) flash, so the
// house stands out as a black silhouette. EGA white / light cyan, Bayer-dithered.
shader_type canvas_item;

uniform bool enabled = false;
uniform sampler2D depth_tex : filter_nearest;

const float BAYER[16] = float[](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);

void fragment() {
	if (!enabled) { discard; }
	vec2 p = floor(UV * vec2(320.0, 168.0));
	float d = texture(depth_tex, (p + 0.5) / vec2(320.0, 168.0)).r;
	if (d < 0.999) { discard; }
	int bi = int(mod(p.y, 4.0)) * 4 + int(mod(p.x, 4.0));
	float t = (BAYER[bi] + 0.5) / 16.0;
	COLOR = t < 0.6 ? vec4(1.0, 1.0, 1.0, 1.0) : vec4(85.0 / 255.0, 1.0, 1.0, 1.0);
}
