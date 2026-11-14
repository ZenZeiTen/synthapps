// Port of hyper-bluff/godot/scripts/view/render.gd: every screen as a list of rectangles and
// texture blits in the 640x360 virtual screen. Nothing here changes the game.
#include <algorithm>
#include <cmath>
#include <cstdio>

#include "HBApp.h"
#include "HBCards.h"
#include "HBData.h"
#include "HBJam.h"

namespace hb {
namespace app {

// ---- colours and maths -----------------------------------------------------------------------

Color Hex(uint32_t rgb, float alpha) {
    return Color{static_cast<float>((rgb >> 16) & 0xFF) / 255.0f, static_cast<float>((rgb >> 8) & 0xFF) / 255.0f,
                 static_cast<float>(rgb & 0xFF) / 255.0f, alpha};
}

Color Rgba(float r, float g, float b, float a) { return Color{r, g, b, a}; }

Color FromHsv(float h, float s, float v, float a) {
    h = h - std::floor(h);
    const float h6 = h * 6.0f;
    const int i = static_cast<int>(std::floor(h6)) % 6;
    const float f = h6 - std::floor(h6);
    const float p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    switch (i) {
        case 0: return Color{v, t, p, a};
        case 1: return Color{q, v, p, a};
        case 2: return Color{p, v, t, a};
        case 3: return Color{p, q, v, a};
        case 4: return Color{t, p, v, a};
        default: return Color{v, p, q, a};
    }
}

const char* TexFile(Tex t) {
    static const char* const n[] = {"font.png", "font_big.png", "font_ital.png", "cards.png", "icons.png",
                                    "portraits.png", "bg_floor1.png", "bg_floor2.png", "bg_floor3.png",
                                    "bg_floor4.png", "bg_floor5.png", "bg_title.png", "chip_spin.png",
                                    "chips.png", "star_spin.png", "trophy.png", "coin_burst.png"};
    return n[static_cast<int>(t)];
}

Layout ComputeLayout(int viewport_w, int viewport_h) {
    Layout l;
    const int sx = viewport_w / kVirtualW;
    const int sy = viewport_h / kVirtualH;
    l.scale = std::max(1, std::min(sx, sy));
    l.off_x = (viewport_w - kVirtualW * l.scale) / 2;
    l.off_y = (viewport_h - kVirtualH * l.scale) / 2;
    return l;
}

bool ToVirtual(const Layout& l, float px, float py, Vec2& out) {
    const float s = static_cast<float>(l.scale);
    out.x = (px - static_cast<float>(l.off_x)) / s;
    out.y = (py - static_cast<float>(l.off_y)) / s;
    return out.x >= 0 && out.y >= 0 && out.x < kVirtualW && out.y < kVirtualH;
}

namespace {
bool Overlaps(const RectF& a, const RectF& b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
bool Encloses(const RectF& outer, const RectF& in) {
    return in.x >= outer.x && in.y >= outer.y && in.x + in.w <= outer.x + outer.w && in.y + in.h <= outer.y + outer.h;
}

const Color kInk = Hex(0x18142c);
const Color kPanel = Color{0.07f, 0.06f, 0.16f, 0.88f};
const Color kGold = Hex(0xf8c438);
const Color kPink = Hex(0xff5fb4);
const Color kCyan = Hex(0x5fe8ff);
const Color kWhite = Color{1, 1, 1, 1};
const Vec2 kDeck = {586, 130};
const uint32_t kAccentHex[5] = {0xffd866, 0xff9a3c, 0x9fd8ff, 0x9dff6a, 0xff5a6e};
const float kPi = 3.14159265358979f;

float RenderEaseOut(float x) {
    x = std::clamp(x, 0.0f, 1.0f);
    const float k = 1.0f - x;
    return 1.0f - k * k * k;
}

int CastRow(const std::vector<std::string>& order, const std::string& id) {
    for (size_t i = 0; i < order.size(); ++i) {
        if (id == order[i]) return static_cast<int>(i);
    }
    return 0;
}

int ExprCol(const std::string& expr) {
    for (size_t i = 0; i < data::kExpr.size(); ++i) {
        if (expr == data::kExpr[i]) return static_cast<int>(i);
    }
    return 0;
}

std::string Upper(std::string t) {
    for (char& c : t) {
        if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
    }
    return t;
}

}  // namespace

std::vector<std::string> WrapText(const std::string& t, size_t chars) {
    std::vector<std::string> lines;
    std::string cur;
    size_t i = 0;
    while (i <= t.size()) {
        size_t j = t.find(' ', i);
        if (j == std::string::npos) j = t.size();
        const std::string word = t.substr(i, j - i);
        if (cur.empty()) {
            cur = word;
        } else if (cur.size() + 1 + word.size() <= chars) {
            cur += " " + word;
        } else {
            lines.push_back(cur);
            cur = word;
        }
        i = j + 1;
    }
    if (!cur.empty()) lines.push_back(cur);
    return lines;
}

std::vector<std::string> PaginateStory(const std::vector<std::string>& pages) {
    std::vector<std::string> out;
    for (const std::string& page : pages) {
        const std::vector<std::string> lines = WrapText(page, kStoryChars);
        if (lines.size() <= kStoryLines) {
            out.push_back(page);
            continue;
        }
        for (size_t i = 0; i < lines.size(); i += kStoryLines) {
            std::string chunk;
            for (size_t k = i; k < lines.size() && k < i + kStoryLines; ++k) chunk += (chunk.empty() ? "" : " ") + lines[k];
            out.push_back(chunk);
        }
    }
    return out;
}

namespace {

std::string Repeat(const std::string& s, int n) {
    std::string out;
    for (int i = 0; i < n; ++i) out += s;
    return out;
}

}  // namespace

// ---- primitives ------------------------------------------------------------------------------

Vec2 App::TexSize(Tex t) const { return tex_size_[static_cast<size_t>(t)]; }

void App::Rect(RectF r, Color c) {
    DrawCmd d;
    d.tex = -1;
    d.x = xf_.ox + r.x * xf_.sx;
    d.y = xf_.oy + r.y * xf_.sy;
    d.w = r.w * xf_.sx;
    d.h = r.h * xf_.sy;
    d.col = c;
    draw_.push_back(d);
}

void App::Outline(RectF r, Color c, float width) {
    Rect(RectF{r.x, r.y, r.w, width}, c);
    Rect(RectF{r.x, r.y + r.h - width, r.w, width}, c);
    Rect(RectF{r.x, r.y + width, width, r.h - 2 * width}, c);
    Rect(RectF{r.x + r.w - width, r.y + width, width, r.h - 2 * width}, c);
}

void App::Sprite(Tex t, RectF dst, RectF src, Color c) {
    DrawCmd d;
    d.tex = static_cast<int>(t);
    d.x = xf_.ox + dst.x * xf_.sx;
    d.y = xf_.oy + dst.y * xf_.sy;
    d.w = dst.w * xf_.sx;
    d.h = dst.h * xf_.sy;
    d.u = src.x;
    d.v = src.y;
    d.uw = src.w;
    d.vh = src.h;
    d.col = c;
    draw_.push_back(d);
}

// Draw text. With box > 0 the text is aligned inside [x, x + box] (0 left, 1 centre, 2 right)
// and a line wider than its box is recorded for the `fit` harness check.
void App::Txt(const std::string& t, float x, float y, Color col, char f, int box, int align) {
    const Tex tex = f == 's' ? Tex::Font : (f == 'b' ? Tex::FontBig : Tex::FontItal);
    const int adv = f == 's' ? 6 : 12;
    const int cw = f == 's' ? 6 : (f == 'b' ? 12 : 16);
    const int ch = f == 's' ? 9 : 18;
    const int w = static_cast<int>(t.size()) * adv;
    if (box > 0) {
        if (w > box) fit_fail_.push_back(std::string(ScreenName(screen_)) + "|" + t);
        if (align == 1) x += static_cast<float>((box - w) / 2);
        else if (align == 2) x += static_cast<float>(box - w);
    }
    x = std::floor(x);
    y = std::floor(y);
    if (!t.empty() && screen_ != Screen::Credits) {
        // Text must stay on the screen (after the current transform).
        const float x0 = xf_.ox + x * xf_.sx, y0 = xf_.oy + y * xf_.sy;
        const float x1 = x0 + static_cast<float>(w) * xf_.sx, y1 = y0 + static_cast<float>(ch) * xf_.sy;
        if (x0 < -0.5f || y0 < -0.5f || x1 > kVirtualW + 0.5f || y1 > kVirtualH + 0.5f) {
            if (xf_.sx == 1.0f && xf_.sy == 1.0f && shake_off_.x == 0 && shake_off_.y == 0 && xf_.ox == 0) {
                fit_fail_.push_back(std::string(ScreenName(screen_)) + " offscreen|" + t);
            }
        }
    }
    if (xf_.sx == 1.0f && xf_.sy == 1.0f && t.find_first_not_of(' ') != std::string::npos) {
        texts_.push_back({RectF{xf_.ox + x, xf_.oy + y, static_cast<float>(w), f == 's' ? 8.0f : 16.0f}, t});
    }
    for (size_t i = 0; i < t.size(); ++i) {
        const int c = static_cast<int>(static_cast<unsigned char>(t[i])) - 32;
        if (c <= 0 || c > 94) continue;
        Sprite(tex, RectF{x + static_cast<float>(i) * static_cast<float>(adv), y, static_cast<float>(cw), static_cast<float>(ch)},
               RectF{static_cast<float>((c % 16) * cw), static_cast<float>((c / 16) * ch), static_cast<float>(cw),
                     static_cast<float>(ch)},
               col);
    }
}

void App::Shadow(const std::string& t, float x, float y, Color col, char f, int box, int align) {
    const float d = f == 's' ? 1.0f : 2.0f;
    Txt(t, x + d, y + d, kInk, f, box, align);
    const size_t before = fit_fail_.size();
    Txt(t, x, y, col, f, box, align);
    fit_fail_.resize(before);
}

void App::TxtFit(const std::string& t, float x, float y, Color col, int box, int align) {
    const int w = static_cast<int>(t.size()) * 6;
    if (w <= box) {
        Txt(t, x, y, col, 's', box, align);
        return;
    }
    // Squeeze: draw at its own width, scaled into the box (the text stays whole and inside).
    const Xf saved = xf_;
    const float k = static_cast<float>(box) / static_cast<float>(w);
    xf_ = Xf{saved.ox + std::floor(x) * saved.sx, saved.oy, saved.sx * k, saved.sy};
    Txt(t, 0, y, col, 's');
    xf_ = saved;
}

int App::WrapBox(const std::string& t, RectF box, float line_h, Color col, int align, int page_ticks) {
    const size_t chars = static_cast<size_t>(std::max(1.0f, std::floor(box.w / 6.0f)));
    const std::vector<std::string> lines = WrapText(t, chars);
    const int fit = std::max(1, static_cast<int>(std::floor((box.h - 9.0f) / line_h)) + 1);
    const int n = static_cast<int>(lines.size());
    int first = 0;
    if (n > fit) {
        const int chunks = (n + fit - 1) / fit;
        first = ((tick_ / std::max(1, page_ticks)) % chunks) * fit;
    }
    int drawn = 0;
    for (int i = first; i < n && i < first + fit; ++i) {
        TxtFit(lines[static_cast<size_t>(i)], box.x, box.y + static_cast<float>(i - first) * line_h, col,
               static_cast<int>(box.w), align);
        ++drawn;
    }
    return drawn;
}

void App::Panel(RectF r, Color fill, Color border) {
    // An opaque panel hides text drawn under it; text only partly hidden is cut in half.
    if (fill.a >= 0.9f && xf_.sx == 1.0f && xf_.sy == 1.0f) {
        const RectF sr{xf_.ox + r.x, xf_.oy + r.y, r.w, r.h};
        std::vector<std::pair<RectF, std::string>> keep;
        for (const auto& e : texts_) {
            if (Encloses(sr, e.first)) continue;
            if (Overlaps(sr.Grow(-1), e.first.Grow(-1)))
                fit_fail_.push_back(std::string(ScreenName(screen_)) + "|cut off under a panel: " + e.second);
            keep.push_back(e);
        }
        texts_.swap(keep);
    }
    Rect(r, fill);
    Outline(r, border);
}

void App::Panel(RectF r) { Panel(r, kPanel, kCyan); }

Color App::Accent() const { return has_run_ ? Hex(kAccentHex[jam::RoomIndex(s_.match)]) : kCyan; }

void App::Room() {
    const int room = has_run_ ? jam::RoomIndex(s_.match) : 0;
    const Tex t = static_cast<Tex>(static_cast<int>(Tex::Floor1) + room);
    Sprite(t, RectF{0, 0, 640, 360}, RectF{0, 0, 640, 360}, kWhite);
}

// A card that slides in from the deck face down and then turns over.
void App::Dealt(int key, int c, float x, float y, bool up) {
    if (!card_has_[static_cast<size_t>(key)]) {
        Card(c, x, y, up);
        return;
    }
    const int t = tick_ - card_t_[static_cast<size_t>(key)];
    if (t < 0) return;
    if (t < kDealTicks) {
        const float k = RenderEaseOut(static_cast<float>(t) / kDealTicks);
        const float px = kDeck.x + (x - kDeck.x) * k;
        const float py = kDeck.y + (y - kDeck.y) * k;
        Card(c, std::round(px), std::round(py - std::sin(k * kPi) * 10.0f), false);
        return;
    }
    const float f = static_cast<float>(t - kDealTicks) / kFlipTicks;
    if (!up || f >= 1.0f) {
        Card(c, x, y, up);
        return;
    }
    const float sx = std::max(std::fabs(1.0f - 2.0f * f), 0.05f);
    const Xf saved = xf_;
    xf_ = Xf{x + 20.0f * (1.0f - sx) + shake_off_.x, y - std::sin(f * kPi) * 3.0f + shake_off_.y, sx, 1.0f};
    Card(c, 0, 0, f >= 0.5f);
    xf_ = saved;
}

void App::Card(int c, float x, float y, bool up, Color tint) {
    const int idx = up ? c : 52;
    Sprite(Tex::Cards, RectF{x, y, 40, 56},
           RectF{static_cast<float>((idx % 13) * 40), static_cast<float>((idx / 13) * 56), 40, 56}, tint);
}

void App::Icon(const std::string& name, float x, float y, Color tint) {
    for (size_t i = 0; i < icon_names_.size(); ++i) {
        if (icon_names_[i] == name) {
            Sprite(Tex::Icons, RectF{x, y, 32, 32}, RectF{static_cast<float>(i) * 32, 0, 32, 32}, tint);
            return;
        }
    }
}

void App::Portrait(const std::string& id, const std::string& expr, float x, float y, bool framed) {
    if (framed) {
        Rect(RectF{x - 2, y - 2, 100, 100}, Rgba(0.05f, 0.04f, 0.12f, 0.75f));
        Outline(RectF{x - 2, y - 2, 100, 100}, id == jam::RivalId(jam::LadderSize() - 1) ? kGold : kCyan);
    }
    Sprite(Tex::Portraits, RectF{x, y, 96, 96},
           RectF{static_cast<float>(ExprCol(expr) * 96), static_cast<float>(CastRow(portrait_order_, id) * 96), 96, 96}, kWhite);
}

void App::Strip(Tex t, int frame, int size, float x, float y) {
    const float fs = static_cast<float>(size);
    Sprite(t, RectF{x, y, fs, fs}, RectF{static_cast<float>(frame) * fs, 0, fs, fs}, kWhite);
}

void App::Menu(const std::vector<std::string>& items) {
    for (size_t i = 0; i < items.size(); ++i) {
        const RectF r = MenuRect(static_cast<int>(i));
        const bool on = static_cast<int>(i) == cursor_;
        Panel(r, on ? Rgba(0.5f, 0.1f, 0.4f, 0.95f) : kPanel, on ? kGold : kCyan);
        btn_rects_.push_back({RectF{xf_.ox + r.x, xf_.oy + r.y, r.w, r.h}, items[i]});
        Txt(items[i], r.x, r.y + (r.h - 9) / 2, on ? kGold : kWhite, 's', static_cast<int>(r.w), 1);
    }
}

void App::SpeedLines(RectF r, Color col, int seed_value) {
    int64_t box = seed_value;
    for (int i = 0; i < 28; ++i) {
        const float y = r.y + static_cast<float>(cards::Roll(box, static_cast<int>(r.h)));
        const float x = r.x + static_cast<float>(cards::Roll(box, static_cast<int>(r.w)));
        const float w = static_cast<float>(30 + cards::Roll(box, 120));
        Rect(RectF{x, y, w, 1}, col);
    }
}

// ---- screens ---------------------------------------------------------------------------------

// Darken everything drawn so far. Text under a strong veil no longer counts as visible.
void App::Veil(float alpha) {
    Rect(RectF{0, 0, 640, 360}, Rgba(0, 0, 0, alpha));
    if (alpha >= 0.8f) {
        texts_.clear();
        btn_rects_.clear();
    }
}

// Report text drawn over other text, and text crossing a button it is not the label of.
void App::CheckOverlaps() {
    for (size_t i = 0; i < texts_.size(); ++i) {
        const RectF a = texts_[i].first.Grow(-1);
        for (size_t j = i + 1; j < texts_.size(); ++j) {
            if (texts_[i].second != texts_[j].second && Overlaps(a, texts_[j].first.Grow(-1)))
                fit_fail_.push_back(std::string(ScreenName(screen_)) + "|overlap: " + texts_[i].second + " / " + texts_[j].second);
        }
        for (const auto& b : btn_rects_) {
            if (b.second != texts_[i].second && Overlaps(a, b.first))
                fit_fail_.push_back(std::string(ScreenName(screen_)) + "|over button " + b.second + ": " + texts_[i].second);
        }
    }
}

const std::vector<DrawCmd>& App::Render() {
    draw_.clear();
    fit_fail_.clear();
    texts_.clear();
    btn_rects_.clear();
    xf_ = Xf();
    shake_off_ = Vec2{0, 0};
    switch (screen_) {
        case Screen::Title: DrawTitle(); break;
        case Screen::Avatar: DrawAvatar(); break;
        case Screen::Story:
        case Screen::Versus: DrawStory(); break;
        case Screen::Play: DrawPlay(); break;
        case Screen::Pause:
            DrawPlay();
            Veil(0.85f);
            Panel(RectF{200, 78, 240, 140}, Rgba(0.05f, 0.04f, 0.14f, 0.96f), kGold);
            Shadow("PAUSED", 0, 90, kGold, 'i', 640, 1);
            Menu(MenuItems());
            break;
        case Screen::Options:
            Backdrop();
            Shadow("OPTIONS", 0, 80, kGold, 'i', 640, 1);
            Menu(MenuItems());
            {
                const RectF last = MenuRect(static_cast<int>(MenuItems().size()) - 1);
                Txt("LEFT / RIGHT CHANGES A VALUE", 0, last.y + last.h + 12, kCyan, 's', 640, 1);
            }
            break;
        case Screen::MatchEnd: DrawMatchEnd(); break;
        case Screen::Scores: DrawScores(); break;
        case Screen::Credits: DrawCredits(); break;
    }
    CheckOverlaps();
    return draw_;
}

void App::Backdrop() {
    Sprite(Tex::Title, RectF{0, 0, 640, 360}, RectF{0, 0, 640, 360}, kWhite);
    Rect(RectF{0, 0, 640, 360}, Rgba(0, 0, 0, 0.35f));
}

void App::Logo(float y) {
    const std::string t = "HYPER BLUFF!!";
    const Xf saved = xf_;
    xf_ = Xf{0, y, 3, 3};
    const float x = (640.0f / 3.0f - static_cast<float>(t.size()) * 12) / 2;
    const float bob = std::sin(static_cast<float>(tick_) * 0.08f) * 1.0f;
    Txt(t, x + 1.4f, 1.4f + bob, kInk, 'i');
    Txt(t, x + 0.7f, 0.7f + bob, kPink, 'i');
    Txt(t, x, bob, kGold, 'i');
    xf_ = saved;
    Shadow("STARLIGHT SHOWDOWN", 0, y + 62, kCyan, 'b', 640, 1);
    // Director's Cut stamp: a red rubber stamp that thumps down when the title appears.
    const std::string stamp = "DIRECTOR'S CUT";
    const float age = static_cast<float>(kScreenLock - lock_) + (lock_ == 0 ? 12.0f : 0.0f);
    const float k = RenderEaseOut(std::min(1.0f, age / 10.0f));
    const float sc = 1.0f + (1.0f - k) * 1.5f;
    const float bw = 188, bh = 26;
    const float cx = 320, cy = 100 + 62 + 30;
    xf_ = Xf{cx - bw * sc / 2, cy - bh * sc / 2, sc, sc};
    const Color red = Rgba(0.86f, 0.12f, 0.2f, 0.92f * k + 0.08f);
    Rect(RectF{0, 0, bw, bh}, Rgba(0.1f, 0.02f, 0.06f, 0.55f * k));
    Outline(RectF{0, 0, bw, bh}, red, 2);
    Outline(RectF{4, 4, bw - 8, bh - 8}, red, 1);
    Txt(stamp, 0, 4, Rgba(1, 0.35f, 0.4f, k), 'b', static_cast<int>(bw), 1);
    xf_ = saved;
}

void App::DrawTitle() {
    Sprite(Tex::Title, RectF{0, 0, 640, 360}, RectF{0, 0, 640, 360}, kWhite);
    SpeedLines(RectF{0, 20, 640, 150}, Rgba(1, 1, 1, 0.12f), tick_ / 4);
    Logo(60);
    Menu(MenuItems());
    Rect(RectF{0, 340, 640, 20}, Rgba(0.03f, 0.02f, 0.1f, 0.85f));
    Txt("ARROWS + Z / ENTER, OR THE MOUSE", 0, 346, Rgba(1, 1, 1, 0.85f), 's', 640, 1);
}

void App::DrawAvatar() {
    Backdrop();
    Shadow("CHOOSE YOUR PLAYER", 0, 40, kGold, 'i', 640, 1);
    for (int i = 0; i < 4; ++i) {
        const std::string id = data::kAvatars[static_cast<size_t>(i)];
        const float x = 68.0f + static_cast<float>(i) * 136;
        const bool on = i == cursor_;
        Portrait(id, on ? "fierce" : "neutral", x, 106.0f - (on ? 4.0f : 0.0f));
        if (on) Outline(RectF{x - 4, 96, 104, 108}, kGold, 2);
    }
    const CastEntry* c = data::FindCast(data::kAvatars[static_cast<size_t>(std::clamp(cursor_, 0, 3))]);
    Panel(RectF{120, 226, 400, 70});
    Shadow(c->name, 120, 232, kGold, 'b', 400, 1);
    Txt(Upper(c->title), 120, 254, kCyan, 's', 400, 1);
    WrapBox(c->blurb, RectF{126, 268, 388, 24}, 11, kWhite, 1);
    Txt("LEFT / RIGHT TO CHOOSE, Z TO START, X TO GO BACK", 0, 330, Rgba(1, 1, 1, 0.7f), 's', 640, 1);
}

void App::DrawStory() {
    const std::string& who = speaker_;
    if (who.empty()) {
        Backdrop();
    } else {
        Room();
        Rect(RectF{0, 0, 640, 360}, Rgba(0, 0, 0, 0.45f));
        SpeedLines(RectF{0, 40, 640, 150}, Rgba(1, 1, 1, 0.1f), tick_ / 5);
        // Director's Cut: each floor is an episode.
        // Director's Cut: every match is an episode ("EPISODE 2: ..." / "INTERLUDE: ...").
        head_ = jam::EpisodeTitle(s_.match);
        Shadow(head_, 0, 20, kCyan, 'b', 640, 1);
        Portrait(s_.avatar, "fierce", 150, 70);
        Shadow("VS", 0, 108, kPink, 'i', 640, 1);
        Portrait(who, page_after_ == "next" ? rexpr_ : "neutral", 394, 70);
        TxtFit(data::FindCast(s_.avatar)->name, 98, 176, kWhite, 200, 1);
        const CastEntry* rc = data::FindCast(who);
        TxtFit(rc->name, 342, 176, kGold, 200, 1);
        TxtFit(Upper(rc->title), 342, 188, kCyan, 200, 1);
    }
    Panel(RectF{60, 214, 520, 100});
    if (page_ < static_cast<int>(pages_.size())) {
        const std::string& full = pages_[static_cast<size_t>(page_)];
        const std::vector<std::string> lines = WrapText(full, kStoryChars);
        int left = std::min(page_t_, static_cast<int>(full.size()));
        for (size_t i = 0; i < lines.size(); ++i) {
            const std::string& line = lines[i];
            const int n = std::clamp(left, 0, static_cast<int>(line.size()));
            Txt(line.substr(0, static_cast<size_t>(n)), 76, 230.0f + static_cast<float>(i) * 14, kWhite);
            left -= static_cast<int>(line.size()) + 1;
            if (line.size() * 6 > 488) fit_fail_.push_back("story|" + line);
        }
        if (lines.size() > kStoryLines) fit_fail_.push_back("story lines|" + full);
    }
    if ((tick_ / 20) % 2 == 0) Txt("Z / CLICK", 510, 300, kGold);
}

void App::DrawMatchEnd() {
    const bool won = s_.winner == 0;
    Room();
    Rect(RectF{0, 0, 640, 360}, Rgba(0, 0, 0, 0.55f));
    head_ = won ? (jam::IsMiniBoss(s_.rival) ? "WARDEN DOWN!!" : "FLOOR CLEARED!!") : "BUSTED...";
    Shadow(head_, 0, 30, won ? kGold : kPink, 'i', 640, 1);
    Portrait(s_.avatar, won ? "happy" : "defeat", 150, 70);
    Portrait(data::kRivals[static_cast<size_t>(s_.rival)], won ? "defeat" : "happy", 394, 70);
    if (won) {
        const Vec2 ts = TexSize(Tex::Trophy);
        Sprite(Tex::Trophy, RectF{288, 86, ts.x, ts.y}, RectF{0, 0, ts.x, ts.y}, kWhite);
    }
    // The panel grows with the rival's last word (wrapped to the panel width, 46 characters).
    const std::vector<std::string>& gloat = data::Rival(s_.rival).gloat;
    const std::string last_word = gloat.empty() ? "" : gloat[0];
    const int body_lines = won ? 1 : static_cast<int>(WrapText(last_word, 46).size());
    Panel(RectF{170, 184, 300, 34.0f + static_cast<float>(body_lines) * 11});
    Txt("SCORE", 186, 192, kCyan);
    Txt(std::to_string(s_.score), 170, 190, kGold, 'b', 288, 2);
    if (won) {
        Txt("FLOOR BONUS  +" + std::to_string(s_.result.match_bonus), 170, 216, kWhite, 's', 300, 1);
        if ((tick_ / 20) % 2 == 0) Txt("Z / CLICK TO GO ON", 0, 260, kGold, 's', 640, 1);
        // Director's Cut: the "next episode" teaser.
        Panel(RectF{100, 284, 440, 30}, Rgba(0.05f, 0.04f, 0.14f, 0.9f), kPink);
        Txt("TO BE CONTINUED...", 100, 288, kPink, 's', 440, 1);
        TxtFit(jam::NextEpisodeLine(s_.match), 104, 300, kWhite, 432, 1);
    } else {
        WrapBox(last_word, RectF{173, 212, 294, static_cast<float>(body_lines) * 11}, 11, kWhite, 1);
        Menu(MenuItems());
    }
}

void App::DrawScores() {
    Backdrop();
    Shadow("HIGH SCORES", 0, 40, kGold, 'i', 640, 1);
    Panel(RectF{140, 84, 360, 200});
    if (scores_.empty()) Txt("NO SCORES YET. THE TOWER AWAITS.", 140, 170, kWhite, 's', 360, 1);
    for (size_t i = 0; i < scores_.size(); ++i) {
        const ScoreEntry& e = scores_[i];
        const float y = 98.0f + static_cast<float>(i) * 36;
        const Color col = static_cast<int>(i) == last_rank_ ? kGold : kWhite;
        Txt(std::to_string(i + 1) + ".", 154, y + 4, col, 'b');
        const CastEntry* c = data::FindCast(e.avatar);
        TxtFit(c ? c->name : e.avatar, 190, y, col, 170);
        Txt(e.clear ? "CHAMPION" : "STAGE " + std::to_string(e.floor_no) + " OF " + std::to_string(jam::LadderSize()), 190,
            y + 12, kCyan, 's', 170);
        Txt(std::to_string(e.score), 360, y + 4, col, 'b', 128, 2);
    }
    if ((tick_ / 20) % 2 == 0) Txt("Z / CLICK TO RETURN", 0, 310, kGold, 's', 640, 1);
}

void App::DrawCredits() {
    Backdrop();
    Rect(RectF{0, 0, 640, 360}, Rgba(0, 0, 0, 0.3f));
    const std::vector<std::string>& credits = jam::Credits();
    for (size_t i = 0; i < credits.size(); ++i) {
        const float y = 360.0f - static_cast<float>(credits_y_) + static_cast<float>(i) * 16;
        if (y < -20 || y > 370) continue;
        if (i < 2) Shadow(credits[i], 0, y, kGold, 'b', 640, 1);
        else Txt(credits[i], 0, y, i % 3 != 0 ? kWhite : kCyan, 's', 640, 1);
    }
    const Vec2 ts = TexSize(Tex::Trophy);
    Sprite(Tex::Trophy, RectF{40, 280, ts.x, ts.y}, RectF{0, 0, ts.x, ts.y}, kWhite);
}

void App::DrawPlay() {
    if (!has_run_) return;
    const State& s = s_;
    const Color acc = Accent();
    Vec2 off{0, 0};
    if (shake_ > 0) {
        off = Vec2{static_cast<float>((tick_ * 7) % 5 - 2), static_cast<float>((tick_ * 13) % 5 - 2)};
    }
    shake_off_ = off;
    xf_ = Xf{off.x, off.y, 1, 1};
    Room();
    if (s.fever) {
        const float hue = std::fmod(static_cast<float>(tick_) * 0.02f, 1.0f);
        for (int i = 0; i < 3; ++i) {
            const float fi = static_cast<float>(i);
            Outline(RectF{fi, fi, 640 - fi * 2, 360 - fi * 2}, FromHsv(std::fmod(hue + fi * 0.1f, 1.0f), 0.8f, 1.0f));
        }
        SpeedLines(RectF{0, 0, 640, 360}, Rgba(1, 1, 1, 0.08f), tick_ / 3);
    }

    // top row: mission, rival, score
    Panel(RectF{6, 4, 256, 14}, kPanel, kGold);
    if (!s.mission.Empty()) TxtFit("BONUS " + s.mission.text, 10, 7, kGold, 250);
    if (s.fever) Shadow("FEVER x3", 10, 22, FromHsv(std::fmod(static_cast<float>(tick_) * 0.03f, 1.0f), 0.6f, 1.0f), 'b');
    float rbob = 0.0f;
    if (bubble_t_ > 0) rbob = std::round(std::sin(static_cast<float>(tick_) * 0.25f));
    if (rexpr_ == "shock" && expr_t_ > Pw(180) - 24) rbob = static_cast<float>(tick_ % 4) - 1.5f;
    const std::string rid = data::kRivals[static_cast<size_t>(s.rival)];
    Portrait(rid, rexpr_, 272 + (rexpr_ == "shock" ? rbob : 0.0f), 14 + (rexpr_ == "shock" ? 0.0f : rbob));
    const CastEntry& rc = data::Rival(s.rival);
    Panel(RectF{376, 12, 150, 30}, kPanel, acc);
    TxtFit(rc.name, 380, 16, kGold, 142);
    Txt("CHIPS " + std::to_string(static_cast<long long>(std::llround(stack_show_[1]))), 380, 28, kWhite, 's', 90);
    if (s.phase == Phase::Bet && s.to_act == 1 && !cutin_.on) {
        Panel(RectF{236, 56, 30, 14}, Rgba(1, 1, 1, 0.95f), kInk);
        Txt(Repeat(".", 1 + (tick_ / 18) % 3), 242, 58, kInk);
    }
    for (size_t i = 0; i < s.powers[1].size(); ++i) Rect(RectF{480.0f + static_cast<float>(i) * 10, 29, 7, 7}, kPink);
    Panel(RectF{532, 20, 104, 44});
    Txt("SCORE", 536, 24, kCyan);
    Txt(std::to_string(s.score), 536, 34, kGold, 's', 96, 2);
    Txt("HAND " + std::to_string(s.hand_no), 536, 44, kWhite, 's', 96);
    if (s.hand_no > 0) {
        Txt("BLINDS " + std::to_string(s.blind[0]) + "/" + std::to_string(s.blind[1]), 536, 54, kWhite, 's', 96);
    }
    Panel(RectF{604, 4, 32, 14}, kPanel, hover_ == "pause" ? kGold : kCyan);
    Txt("MENU", 604, 7, kWhite, 's', 32, 1);
    if (bubble_t_ > 0 && !bubble_.empty()) {
        // At most 4 lines (the bubble must not cover the board); longer lines page through.
        const size_t nl = std::min<size_t>(4, WrapText(bubble_, 38).size());
        const float by = 40.0f - (1.0f - RenderEaseOut(static_cast<float>(bubble_age_) / 12.0f)) * 10.0f;
        Panel(RectF{22, by, 240, 8.0f + static_cast<float>(nl) * 11}, Rgba(1, 1, 1, 0.95f), kInk);
        WrapBox(bubble_, RectF{28, by + 5, 228, 9.0f + static_cast<float>(nl - 1) * 11}, 11, kInk, 0, 120);
    }

    // rival hole cards
    const std::vector<int>& seen = s.fx.peek[0];
    for (int i = 0; i < 2; ++i) {
        if (s.hole[1].size() < 2) continue;
        const bool up = reveal_ || std::find(seen.begin(), seen.end(), i) != seen.end();
        Dealt(kKeyR0 + i, s.hole[1][static_cast<size_t>(i)], 380.0f + static_cast<float>(i) * 44, 46, up);
        if (up && !reveal_) Txt("SEEN", 380.0f + static_cast<float>(i) * 44, 104, kCyan, 's', 40, 1);
    }

    // board
    for (int i = 0; i < 5; ++i) Rect(RectF{208.0f + static_cast<float>(i) * 46, 128, 40, 56}, Rgba(0, 0, 0, 0.18f));
    for (int k = 0; k < 3; ++k) Card(0, kDeck.x - static_cast<float>(k), kDeck.y - static_cast<float>(k), false);
    for (size_t i = 0; i < s.board.size(); ++i) {
        const float bx = 208.0f + static_cast<float>(i) * 46;
        Dealt(kKeyB0 + static_cast<int>(i), s.board[i], bx, 128, true);
        bool star = false;
        for (const auto& st : s.stars) star = star || st.first == static_cast<int>(i);
        const int since = card_has_[static_cast<size_t>(kKeyB0) + i] ? tick_ - card_t_[static_cast<size_t>(kKeyB0) + i] : 999;
        if (star && since > kDealTicks + kFlipTicks) Strip(Tex::StarSpin, (tick_ / 6) % 8, 24, bx + 22, 120);
    }
    // Director's Cut: retaken cards hold their place under the cut-in, then fly off the table.
    for (const FlyOff& f : flyoffs_) {
        const float bx = 208.0f + static_cast<float>(f.idx) * 46;
        const int t = tick_ - f.start;
        if (t < 0) {
            Card(f.card, bx, 128, true);
        } else {
            const float k = static_cast<float>(t) / kFlyOffTicks;
            const float e = k * k;  // ease-in: the shot is thrown away
            Card(f.card, std::round(bx + e * 420.0f), std::round(128.0f - e * 190.0f + std::sin(k * kPi) * -12.0f), true,
                 Rgba(1, 1, 1, 1.0f - k * 0.5f));
        }
    }
    const std::vector<int> kb = game::KnownBoard(s, 0);
    if (kb.size() > s.board.size()) {
        const size_t i2 = s.board.size();
        Card(kb[i2], 208.0f + static_cast<float>(i2) * 46, 128, true, Rgba(1, 1, 1, 0.55f));
        Txt("SIGHT", 208.0f + static_cast<float>(i2) * 46, 186, kCyan, 's', 40, 1);
    }
    Panel(RectF{444, 128, 88, 56}, kPanel, acc);
    Txt("POT", 448, 132, acc);
    Txt(std::to_string(static_cast<long long>(std::llround(pot_show_))), 476, 142, kGold, 'b', 52, 2);
    Strip(Tex::ChipSpin, (tick_ / 5) % 8, 24, 448, 139);
    Txt("STARS +" + std::to_string(s.star_pot), 448, 164, s.star_pot > 0 ? kGold : Rgba(1, 1, 1, 0.4f), 's', 80);
    if (s.bet[1] > 0) {
        Strip(Tex::Chips, 1, 20, 186, 106);
        Shadow("BET " + std::to_string(s.bet[1]), 208, 112, kWhite);
    }
    if (s.bet[0] > 0) {
        Strip(Tex::Chips, 2, 20, 186, 186);
        Shadow("BET " + std::to_string(s.bet[0]), 208, 192, kWhite);
    }
    if (burst_t_ > 0) Strip(Tex::CoinBurst, std::clamp((36 - burst_t_) / 6, 0, 5), 32, 472, 136);
    if (s.phase != Phase::Pre) Icon("dealer", 232, s.button == 0 ? 216.0f : 78.0f);

    // player side
    Portrait(s.avatar, pexpr_, 10, 196);
    TxtFit(data::FindCast(s.avatar)->name, 8, 298, kWhite, 100, 1);
    Txt("CHIPS " + std::to_string(static_cast<long long>(std::llround(stack_show_[0]))), 8, 309, kGold, 's', 100, 1);
    for (size_t i = 0; i < s.hole[0].size() && i < 2; ++i) {
        Dealt(kKeyP0 + static_cast<int>(i), s.hole[0][i], 276.0f + static_cast<float>(i) * 46, 206, true);
    }
    DrawMeter(376, 204);
    for (int i = 0; i < 3; ++i) {
        const float x = 532.0f + static_cast<float>(i) * 35;
        const std::vector<Power>& inv = s.powers[0];
        if (i < static_cast<int>(inv.size())) {
            const Power pw = inv[static_cast<size_t>(i)];
            const bool usable = MyTurn() && game::CanUse(s, 0, pw);
            Icon(PowerName(pw), x, 204, usable ? kWhite : Rgba(0.55f, 0.55f, 0.6f));
            if (hover_ == "power:" + std::to_string(i)) Outline(RectF{x - 1, 203, 34, 34}, kGold);
        } else {
            Icon("empty", x, 204);
        }
        Txt(std::to_string(i + 1), x, 238, kCyan, 's', 32, 1);
    }
    int hp = -1;
    if (hover_.rfind("power:", 0) == 0) hp = hover_[6] - '0';
    if (hp >= 0 && hp < static_cast<int>(s.powers[0].size())) {
        const PowerInfo& info = data::PowerInfoOf(s.powers[0][static_cast<size_t>(hp)]);
        const float lines = static_cast<float>(std::min<size_t>(2, WrapText(info.desc, 41).size()));
        Panel(RectF{376, 262, 258, 15 + lines * 11});
        TxtFit(info.name, 380, 265, kGold, 250);
        WrapBox(info.desc, RectF{380, 276, 250, 9 + (lines - 1) * 11}, 11, kWhite);
    } else {
        Txt("POINT AT A POWER FOR ITS EFFECT", 376, 268, Rgba(1, 1, 1, 0.6f), 's', 258, 2);
    }

    if (static_cast<int>(msg_.size()) * 6 <= 450) Shadow(msg_, 112, 304, kWhite, 's', 450, 1);
    else TxtFit(msg_, 112, 304, kWhite, 450, 1);
    DrawButtons();
    for (const Flier& f : fliers_) {
        if (f.delay > 0) continue;
        const float k = RenderEaseOut(static_cast<float>(f.t) / static_cast<float>(f.dur));
        const float px = f.from.x + (f.to.x - f.from.x) * k;
        const float py = f.from.y + (f.to.y - f.from.y) * k;
        Strip(Tex::Chips, f.frame, 20, std::round(px), std::round(py - std::sin(k * kPi) * 14.0f));
    }
    for (const Pop& p : pops_) {
        const float rise = RenderEaseOut(static_cast<float>(110 - p.t) / 30.0f);
        Shadow(p.text, p.x, p.y + (1.0f - rise) * 8.0f, p.col, 'b');
    }
    if ((s.phase == Phase::HandOver || s.phase == Phase::MatchOver) && wait_ == 0 && s.result.set) {
        xf_ = Xf{off.x + 280.0f * (1.0f - RenderEaseOut(static_cast<float>(result_t_) / 16.0f)), off.y, 1, 1};
        DrawResult();
        xf_ = Xf{off.x, off.y, 1, 1};
    }
    xf_ = Xf();
    if (cutin_.on) DrawCutIn();
}

void App::DrawMeter(float x, float y) {
    const State& s = s_;
    Panel(RectF{x, y, 150, 54}, kPanel, Accent());
    Txt("AURA METER", x + 4, y + 4, Accent());
    if (s.hole[0].empty()) return;
    const float v = std::clamp(static_cast<float>(meter_show_), 0.0f, 1.0f);
    Txt(std::to_string(static_cast<int>(std::lround(v * 100))) + "%", x + 4, y + 4, kWhite, 's', 142, 2);
    Rect(RectF{x + 4, y + 16, 142, 10}, Rgba(0, 0, 0, 0.6f));
    const int w = static_cast<int>(142 * v);
    for (int i = 0; i < w; i += 2) {
        const float k = static_cast<float>(i) / 142.0f;
        Rect(RectF{x + 4 + static_cast<float>(i), y + 16, 2, 10}, FromHsv(0.38f * k, 0.85f, 1.0f));
    }
    if (v >= 0.7f) {
        const int fl = 3 + (tick_ / 3) % 4;
        const float fw = static_cast<float>(w);
        Rect(RectF{x + 4 + fw - 2, y + 16 - static_cast<float>(fl), 3, static_cast<float>(fl)}, kGold);
        Rect(RectF{x + 4 + fw - 6, y + 16 - static_cast<float>(fl / 2), 2, static_cast<float>(fl / 2)}, kPink);
    }
    Outline(RectF{x + 4, y + 16, 142, 10}, kWhite);
    Txt(MeterTier(), x + 4, y + 30, v >= 0.7f ? kGold : kWhite, 's', 142);
    std::vector<int> cs = s.hole[0];
    cs.insert(cs.end(), s.board.begin(), s.board.end());
    Txt(cards::NameOf(cards::Eval(cs)), x + 4, y + 41, kCyan, 's', 144);
}

void App::DrawButtons() {
    const State& s = s_;
    const bool live = MyTurn();
    const int need = s.phase == Phase::Bet ? game::ToCall(s, 0) : 0;
    const std::vector<int> ro = RaiseOpts();
    std::string labels[3] = {"FOLD", need == 0 ? "CHECK" : "CALL " + std::to_string(need), "RAISE"};
    if (!ro.empty()) {
        const int amt = ro[static_cast<size_t>(std::clamp(raise_i_, 0, static_cast<int>(ro.size()) - 1))];
        if (amt == ro.back()) labels[2] = "ALL-IN " + std::to_string(amt);
        else if (std::max(s.bet[0], s.bet[1]) == 0) labels[2] = "BET " + std::to_string(amt);
        else labels[2] = "RAISE TO " + std::to_string(amt);
    } else if (live) {
        labels[2] = "NO RAISE";
    }
    const RectF rects[3] = {RectF{112, 322, 100, 30}, RectF{218, 322, 130, 30}, RectF{354, 322, 150, 30}};
    const char* const keys[3] = {"F", "C", "R"};
    const Color dim = Rgba(0.4f, 0.4f, 0.5f);
    for (int i = 0; i < 3; ++i) {
        const bool on = live && i == btn_;
        Color fill = on ? Rgba(0.5f, 0.1f, 0.4f, 0.95f) : kPanel;
        if (!live) fill = Rgba(0.1f, 0.1f, 0.14f, 0.7f);
        RectF r = rects[i];
        if (on) r = r.Grow(1.0f + std::round(std::sin(static_cast<float>(tick_) * 0.15f)));
        Panel(r, fill, on ? kGold : (live ? Accent() : dim));
        Txt(labels[i], rects[i].x, 328, live ? kWhite : Rgba(0.6f, 0.6f, 0.65f), 's', static_cast<int>(rects[i].w), 1);
        Txt(keys[i], rects[i].x, 340, live ? kCyan : dim, 's', static_cast<int>(rects[i].w), 1);
    }
    for (int i = 0; i < 2; ++i) {
        const RectF r{510.0f + static_cast<float>(i) * 28, 322, 24, 30};
        Panel(r, kPanel, live && ro.size() > 1 ? kCyan : dim);
        Txt(i == 0 ? "-" : "+", r.x, 333, kWhite, 's', 24, 1);
    }
}

void App::DrawResult() {
    const State& s = s_;
    const Result& res = s.result;
    const int w = res.winner;
    // Right-hand panel over the meter and powers: the cards and the buttons stay visible.
    const RectF r{372, 116, 264, 202};
    Panel(r, Rgba(0.05f, 0.04f, 0.14f, 0.96f), kGold);
    const float x0 = r.x + 8;
    const int tw = static_cast<int>(r.w) - 16;
    std::string head = "SPLIT POT";
    if (w == 0) head = "YOU WIN!!";
    else if (w == 1) head = "RIVAL WINS";
    Shadow(head, r.x, r.y + 6, w == 0 ? kGold : (w == 1 ? kPink : kWhite), 'i', static_cast<int>(r.w), 1);
    const float prompt_y = r.y + r.h - 14;
    // Rows are squeezed (never closer than one text height) so the panel holds every line.
    const float need = (res.showdown ? 24.0f : 13.0f) + 11.0f * static_cast<float>(res.lines.size()) +
                       (res.points > 0 ? 15.0f : 0.0f) + (res.guarded ? 11.0f : 0.0f) + (res.power != Power::None ? 11.0f : 0.0f);
    const float avail = prompt_y - 2 - (r.y + 28);
    const float k = need > avail ? std::max(9.0f / 11.0f, avail / need) : 1.0f;
    float y = r.y + 28;
    if (res.showdown) {
        TxtFit("YOU: " + cards::NameOf(res.vals[0]), x0, y, kWhite, tw);
        TxtFit("RIVAL: " + cards::NameOf(res.vals[1]), x0, y + 11 * k, kWhite, tw);
        y += 24 * k;
    } else {
        Txt("NO SHOWDOWN", x0, y, kWhite, 's', tw);
        y += 13 * k;
    }
    for (const ResultLine& line : res.lines) {
        const std::string v = "+" + std::to_string(line.value);
        TxtFit(line.label, x0, y, kCyan, tw - static_cast<int>(v.size()) * 6 - 6);
        Txt(v, x0, y, kGold, 's', tw, 2);
        y += 11 * k;
    }
    if (res.points > 0) {
        Rect(RectF{x0, std::floor(y + 1), static_cast<float>(tw), 1}, kGold);
        Txt("POINTS", x0, y + 4, kWhite, 's', 100);
        Txt("+" + std::to_string(res.points), x0, y + 4, kGold, 's', tw, 2);
        y += 15 * k;
    }
    if (res.guarded) {
        TxtFit("IRON GUARD SAVED HALF THE BET", x0, y, kCyan, tw);
        y += 11 * k;
    }
    if (res.power != Power::None) {
        TxtFit(std::string("NEW POWER: ") + data::PowerInfoOf(res.power).name, x0, y, kPink, tw);
        y += 11 * k;
    }
    if (y > prompt_y - 2 + 0.5f) fit_fail_.push_back("result|" + std::to_string(res.lines.size()) + " lines run into the prompt");
    if ((tick_ / 20) % 2 == 0) {
        Txt(std::string("Z / CLICK: ") + (s.phase == Phase::MatchOver ? "RESULT" : "NEXT HAND"), r.x, prompt_y, kGold, 's',
            static_cast<int>(r.w), 1);
    }
}

// The Director's Cut clapperboard: slate, stripes, and an arm that snaps shut 12 ticks in.
void App::DrawClapper(float x, float y, int age) {
    const float jolt = age >= 12 && age < 16 ? 2.0f : 0.0f;
    const float by = y + 14 + jolt;
    Rect(RectF{x, by, 56, 34}, kInk);
    Outline(RectF{x, by, 56, 34}, kWhite);
    Rect(RectF{x + 4, by + 13, 48, 1}, Rgba(1, 1, 1, 0.6f));
    Txt("TAKE 2", x + 4, by + 3, kWhite, 's', 48, 1);
    Txt("SC. 5", x + 4, by + 17, kGold, 's', 48, 1);
    // the arm: raised and open until the snap, then shut on the slate
    const float lift = age < 12 ? 7.0f : 0.0f;
    const float ay = by - 9 - lift;
    for (int i = 0; i < 7; ++i) Rect(RectF{x + static_cast<float>(i) * 8, ay, 8, 8}, i % 2 ? kWhite : kInk);
    Outline(RectF{x, ay, 56, 8}, kWhite);
    Rect(RectF{x, by - 1, 56, 1}, kWhite);
}

void App::DrawCutIn() {
    const CutIn& c = cutin_;
    const int who = c.who;
    const std::string id = who == 0 ? s_.avatar : std::string(data::kRivals[static_cast<size_t>(s_.rival)]);
    const int t = c.t;
    const float slide = RenderEaseOut(static_cast<float>(c.len - t) / 14.0f) * RenderEaseOut(static_cast<float>(t) / 10.0f);
    const Color col = who == 0 ? Rgba(0.1f, 0.25f, 0.7f, 0.92f) : Rgba(0.6f, 0.08f, 0.2f, 0.92f);
    const float h = 100.0f * RenderEaseOut(static_cast<float>(c.len - t) / 8.0f) * RenderEaseOut(static_cast<float>(t) / 8.0f);
    if (h < 96.0f) {
        Rect(RectF{0, 160 - h / 2, 640, h}, col);
        return;
    }
    Rect(RectF{0, 110, 640, 100}, c.clap ? Rgba(0.08f, 0.07f, 0.1f, 0.94f) : col);
    Rect(RectF{0, 108, 640, 2}, kGold);
    Rect(RectF{0, 210, 640, 2}, kGold);
    SpeedLines(RectF{0, 112, 640, 96}, Rgba(1, 1, 1, 0.5f), tick_ / 2);
    const int row = CastRow(portrait_order_, id);
    const auto eye = eye_y_.find(id);
    const int ey = eye == eye_y_.end() ? 30 : eye->second;
    const float x = who == 0 ? -400.0f + slide * 420.0f : 640.0f - slide * 420.0f;
    Sprite(Tex::Portraits, RectF{x, 112, 384, 96}, RectF{4 * 96, static_cast<float>(row * 96 + ey), 96, 24}, kWhite);
    const float tx = who == 0 ? 420.0f : 24.0f;
    Shadow(c.text, tx - 8, 136, kGold, 'i', 216, 1);
    Shadow(data::FindCast(id)->shout, tx - 40, 170, kWhite, 's', 280, 1);
    if (c.clap) DrawClapper(who == 0 ? 344.0f : 240.0f, 116, c.len - t);
}

}  // namespace app
}  // namespace hb
