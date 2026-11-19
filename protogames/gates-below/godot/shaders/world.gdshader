// Every surface in the dungeon: walls, floors, doors, decals, monster and item sprites.
// Unshaded: light is the party's torch (falling off with distance) plus wall torches,
// quantised into bands like the original's five darkness palettes, then mixed toward the
// level's fog colour with distance (the original's five fog palettes, pcx.c:77-111).
shader_type spatial;
render_mode unshaded, cull_back, depth_draw_opaque, shadows_disabled;

uniform sampler2D tex : source_color, filter_nearest, repeat_disable;
uniform vec4 region = vec4(0.0, 0.0, 1.0, 1.0);   // atlas frame: uv offset xy, size zw
uniform bool flip = false;
uniform vec4 fog_color : source_color = vec4(0.11, 0.09, 0.15, 1.0);
uniform float fog_near = 3.0;
uniform float fog_far = 11.0;
uniform float ambient = 0.3;
uniform float torch = 0.9;
uniform float torch_range = 8.0;
uniform vec4 lights[8];
uniform int light_count = 0;
uniform float glow = 0.0;       // self-lit (flames, wisps)
uniform float flash = 0.0;      // hit flash toward white
uniform float bands = 5.0;

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 uv = UV;
	if (flip) {
		uv.x = 1.0 - uv.x;
	}
	vec4 c = texture(tex, region.xy + uv * region.zw);
	if (c.a < 0.5) {
		discard;
	}
	float d = distance(wpos, CAMERA_POSITION_WORLD);
	float l = ambient + torch * clamp(1.0 - d / torch_range, 0.0, 1.0);
	for (int i = 0; i < 8; i++) {
		if (i >= light_count) {
			break;
		}
		float dl = distance(wpos, lights[i].xyz);
		l += lights[i].w * clamp(1.0 - dl / 3.5, 0.0, 1.0);
	}
	l = floor(l * bands + 0.5) / bands;
	l = max(l, glow);
	vec3 col = c.rgb * min(l, 1.3);
	col = mix(col, vec3(1.0), flash);
	float f = clamp((d - fog_near) / (fog_far - fog_near), 0.0, 1.0);
	f = floor(f * 5.0 + 0.5) / 5.0;
	ALBEDO = mix(col, fog_color.rgb, f * (1.0 - glow * 0.6));
}
