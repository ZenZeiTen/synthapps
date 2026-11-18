// Hyper Bluff!! app layer: small value types shared by the app, the renderer and the hosts
// (the Unreal wrappers in Game/ and the Linux test runner in tests/app/).
// Plain C++20, no engine headers. Everything is in namespace hb::app.
//
// Naming note: these files are compiled inside an Unreal module, where Windows and engine
// headers define macros such as PI, check, verify, TEXT, DrawText, PlaySound, LoadImage,
// ERROR, small, near, far and interface. None of those names is used as an identifier here.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace hb {
namespace app {

// sRGB colour, components 0..1 (the same numbers Godot's Color uses). Hosts that blend in
// linear space convert (Unreal: FLinearColor(FColor)).
struct Color {
    float r = 1.0f;
    float g = 1.0f;
    float b = 1.0f;
    float a = 1.0f;
};

Color Hex(uint32_t rgb, float alpha = 1.0f);  // Hex(0x18142c)
Color Rgba(float r, float g, float b, float a = 1.0f);
Color FromHsv(float h, float s, float v, float a = 1.0f);  // Godot Color.from_hsv

struct Vec2 {
    float x = 0.0f;
    float y = 0.0f;
};

struct RectF {
    float x = 0.0f;
    float y = 0.0f;
    float w = 0.0f;
    float h = 0.0f;
    bool Has(Vec2 p) const { return p.x >= x && p.y >= y && p.x < x + w && p.y < y + h; }
    Vec2 Center() const { return Vec2{x + w * 0.5f, y + h * 0.5f}; }
    RectF Grow(float by) const { return RectF{x - by, y - by, w + 2 * by, h + 2 * by}; }
};

// Every image the game draws, in Content/Raw/Art/<TexFile>.
enum class Tex : int {
    Font, FontBig, FontItal, Cards, Icons, Portraits,
    Floor1, Floor2, Floor3, Floor4, Floor5, Title,
    ChipSpin, Chips, StarSpin, Trophy, CoinBurst,
    Count
};
constexpr int kTexCount = static_cast<int>(Tex::Count);
const char* TexFile(Tex t);  // "font.png"

// One draw call in the 640x360 virtual screen. tex < 0: a filled rectangle in `col`.
// Otherwise the texel rectangle (u, v, uw, vh) of that texture, stretched over
// (x, y, w, h) and multiplied by `col`.
struct DrawCmd {
    int tex = -1;
    float x = 0.0f, y = 0.0f, w = 0.0f, h = 0.0f;
    float u = 0.0f, v = 0.0f, uw = 0.0f, vh = 0.0f;
    Color col;
};

constexpr int kVirtualW = 640;
constexpr int kVirtualH = 360;

// Integer scaling of the virtual screen into a viewport, centred, letterboxed.
struct Layout {
    int scale = 1;
    int off_x = 0;
    int off_y = 0;
};
Layout ComputeLayout(int viewport_w, int viewport_h);
// Viewport pixel -> virtual coordinate. False when the point is outside the 640x360 area.
bool ToVirtual(const Layout& l, float px, float py, Vec2& out);

// What the app needs from the platform. File names are relative to the save folder
// (Saved/HyperBluff/ in Unreal); a name may contain one "harness/" sub folder.
class Host {
public:
    virtual ~Host() = default;
    virtual bool ReadText(const std::string& name, std::string& out) = 0;
    virtual bool WriteText(const std::string& name, const std::string& text) = 0;
    virtual void RemoveFile(const std::string& name) = 0;
    virtual bool HasFile(const std::string& name) = 0;
    virtual void PlaySfx(const std::string& name) = 0;
    virtual void PlayMusic(const std::string& name) = 0;
    virtual void ApplyVolume(int music_0_10, int sfx_0_10) = 0;
    virtual void SetFullscreen(bool on) = 0;
    virtual void Print(const std::string& line) = 0;  // harness DUMP / HARNESS lines
    virtual void Quit() = 0;
    virtual int64_t NowSeed() = 0;  // seed for a new run outside the harness
};

}  // namespace app
}  // namespace hb
